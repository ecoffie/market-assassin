import { describe, expect, it } from 'vitest';
import { runSeoHealth, type RunDeps } from './run';
import type { PagedGscResult } from './observe';
import type { SeoHealthStore } from './store';
import { STRATA, type Cursor, type Stratum, type Stream, type UrlCheck } from './types';

const ORIGIN = 'https://getmindy.ai';
const ROOTS = Array.from({ length: 8 }, (_, i) => `${ORIGIN}/contractors/c${i}`);
const CONTRACTS = Array.from({ length: 6 }, (_, i) => `${ORIGIN}/contractors/c${i}/contracts`);
const HUBS = [`${ORIGIN}/`, `${ORIGIN}/pricing`];
const PAGES = [...ROOTS, ...CONTRACTS, ...HUBS];
// Fixed clock: 2026-09-29 noon UTC. The daily stratum-order rotation is deterministic for it.
const NOW = Date.UTC(2026, 8, 29, 12);
const goodHtml = (url: string) => `<html><head><link rel="canonical" href="${url}"></head><body><h1>X</h1><p>${'word '.repeat(300)}</p></body></html>`;

function siteFetch(opts: { sitemapDown?: boolean } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sitemap-index.xml')) {
      if (opts.sitemapDown) return new Response('down', { status: 503 });
      return new Response('<urlset>' + PAGES.map((p) => `<url><loc>${p}</loc></url>`).join('') + '</urlset>', { status: 200 });
    }
    return new Response(goodHtml(url), { status: 200 });
  }) as typeof fetch;
}

const completeGsc = async (): Promise<PagedGscResult> => ({ rows: [{ keys: ['2026-09-20', ROOTS[0]], clicks: 1, impressions: 10 }], pages: 1, rowCount: 1, complete: true });

function memoryStore(overrides: Partial<SeoHealthStore> = {}) {
  const cursors = new Map<string, Cursor>();
  const checks: UrlCheck[] = [];
  const runs: Array<Record<string, unknown>> = [];
  const upserts: unknown[] = [];
  let saves = 0;
  const key = (s: Stream, t: Stratum) => `${s}|${t}`;
  const store: SeoHealthStore = {
    startRun: async () => { runs.push({ status: 'running' }); return runs.length; },
    updateRun: async (id, patch) => { Object.assign(runs[id - 1], patch); },
    loadCursor: async (s, t) => ({ ...(cursors.get(key(s, t)) ?? { stream: s, stratum: t, last_url: null, cycle: 0 }) }),
    saveCursor: async (c) => { cursors.set(key(c.stream, c.stratum), { ...c }); saves++; },
    insertChecks: async (_id, cs) => { checks.push(...cs); return new Set(cs.map((c) => c.url)); },
    upsertStratumDaily: async (rows) => { upserts.push(...rows); },
    crawlHistory: async () => [],
    canaryHistory: async () => [],
    previousRunSummary: async () => null,
    inspections: async () => [],
    latestRuns: async () => [],
    ...overrides,
  };
  const cur = (s: Stream, t: Stratum) => cursors.get(key(s, t))?.last_url ?? null;
  return { store, checks, runs, upserts, cur, saves: () => saves };
}

function deps(store: SeoHealthStore, over: Partial<RunDeps> = {}): RunDeps {
  return {
    fetch: siteFetch(),
    gsc: { datePageRows: completeGsc, inspect: async () => ({ ok: true as const, result: { verdict: 'PASS', coverageState: 'Submitted and indexed' } }) },
    store,
    postSlack: async () => ({ ok: true }),
    now: () => NOW,
    liveBqEnabled: () => false,
    budgets: {
      crawl: { hub: 1, contractor_root: 3, contractor_contracts: 2, contractor_agencies: 2, contractor_naics: 2, programmatic_other: 2 },
      inspect: { hub: 1, contractor_root: 3, contractor_contracts: 2, contractor_agencies: 2, contractor_naics: 2, programmatic_other: 2 },
    },
    ...over,
  };
}

describe('runSeoHealth (stratified)', () => {
  it('a clean run advances an INDEPENDENT cursor per stratum and per stream', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store));
    expect(r.status).toBe('ok');
    expect(r.slack).toBe('posted');
    for (const stream of ['crawl', 'inspect'] as const) {
      expect(m.cur(stream, 'contractor_root')).toBe(`${ORIGIN}/contractors/c2`); // 3 of the sorted roots
      expect(m.cur(stream, 'contractor_contracts')).toBe(`${ORIGIN}/contractors/c1/contracts`); // 2 of them
      expect(m.cur(stream, 'hub')).toBe(`${ORIGIN}/`); // 1 of 2 hubs
      expect(m.cur(stream, 'contractor_naics')).toBeNull(); // empty stratum: nothing to advance
    }
    const strata = (r.summary.strata as Record<string, number>);
    expect(strata).toMatchObject({ contractor_root: 8, contractor_contracts: 6, hub: 2, contractor_naics: 0 });
  });

  it('records coverage math per stratum (population / per-run allocation)', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store));
    const byStratum = (r.summary.inspect as { byStratum: Record<string, { population: number; perRun: number; coverageDays: number | null }> }).byStratum;
    expect(byStratum.contractor_root).toMatchObject({ population: 8, perRun: 3, coverageDays: 3 });
    expect(byStratum.contractor_contracts).toMatchObject({ population: 6, perRun: 2, coverageDays: 3 });
  });

  it('unreadable sitemap: run fails, no cursor moves, failure still reported', async () => {
    const m = memoryStore();
    let posted = '';
    const r = await runSeoHealth(deps(m.store, { fetch: siteFetch({ sitemapDown: true }), postSlack: async (t) => { posted = t; return { ok: true }; } }));
    expect(r).toMatchObject({ status: 'failed', ok: false });
    expect(m.saves()).toBe(0);
    expect(posted).toMatch(/failed/);
  });

  it('incomplete Search Console response: run is partial, no trend written, drop not evaluated', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store, { gsc: { datePageRows: async () => ({ rows: [{ keys: ['2026-09-20', ROOTS[0]], clicks: 0, impressions: 1 }], pages: 1, rowCount: 1, complete: false, error: 'page 2 failed: GSC API 500' }), inspect: async () => ({ ok: true as const, result: { verdict: 'PASS' } }) } }));
    expect(r.status).toBe('partial');
    expect(m.upserts).toEqual([]);
    expect(r.summary.searchConsole).toMatchObject({ complete: false, evaluated: false });
    expect(r.problems.join(' ')).toMatch(/search console incomplete/);
  });

  it('asks Search Console only for the mature 31-day window ending 3 days ago', async () => {
    const m = memoryStore();
    const windows: string[][] = [];
    await runSeoHealth(deps(m.store, { gsc: { datePageRows: async (a, b) => { windows.push([a, b]); return completeGsc(); }, inspect: async () => ({ ok: true as const, result: { verdict: 'PASS' } }) } }));
    expect(windows).toEqual([['2026-08-27', '2026-09-26']]);
  });

  it('Google 429 mid-stratum: that cursor stops before the unobserved URL, later strata are not advanced, and it resumes', async () => {
    const m = memoryStore();
    const seen: string[] = [];
    let n = 0;
    const inspect = async (u: string) => {
      seen.push(u);
      return ++n === 2 ? { ok: false as const, status: 429, error: 'quota' } : { ok: true as const, result: { verdict: 'PASS', coverageState: 'Submitted and indexed' } };
    };
    const r = await runSeoHealth(deps(m.store, { gsc: { datePageRows: completeGsc, inspect } }));
    expect(r.status).toBe('partial');
    const firstStratum = seen[0].includes('/contracts') ? 'contractor_contracts' : seen[0].endsWith('/') || seen[0].endsWith('/pricing') ? 'hub' : 'contractor_root';
    expect(m.cur('inspect', firstStratum as Stratum)).toBe(seen[0]); // committed only the URL before the 429
    const untouched = STRATA.filter((s) => s !== firstStratum && m.cur('inspect', s) !== null);
    expect(untouched).toEqual([]); // nothing after the stop advanced
    const next: string[] = [];
    await runSeoHealth(deps(m.store, { gsc: { datePageRows: completeGsc, inspect: async (u) => { next.push(u); return { ok: true as const, result: { verdict: 'PASS' } }; } } }));
    expect(next).toContain(seen[1]); // the URL that hit the 429 is observed next run
  });

  it('a permanent per-URL inspection error is recorded and moved past', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store, { gsc: { datePageRows: completeGsc, inspect: async () => ({ ok: false as const, status: 400, error: 'not in property' }) } }));
    expect(m.cur('inspect', 'contractor_root')).toBe(`${ORIGIN}/contractors/c2`);
    expect(m.checks.filter((c) => c.source === 'inspect').every((c) => c.outcome === 'inspection_error')).toBe(true);
    expect(r.status).toBe('ok');
  });

  it('results that could not be recorded do not move any cursor', async () => {
    const m = memoryStore({ insertChecks: async () => { throw new Error('db down'); } });
    const r = await runSeoHealth(deps(m.store));
    expect(r.status).toBe('partial');
    for (const s of STRATA) {
      expect(m.cur('crawl', s)).toBeNull();
      expect(m.cur('inspect', s)).toBeNull();
    }
  });

  it('time budget: only observed URLs commit; unstarted ones resume next run', async () => {
    const m = memoryStore();
    let t = NOW;
    const slowFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sitemap-index.xml')) return siteFetch()(input);
      if (/\/contractors\//.test(url) && !url.includes('the-boeing-company')) t += 1000;
      return new Response(goodHtml(url), { status: 200 });
    }) as typeof fetch;
    const r = await runSeoHealth(deps(m.store, { fetch: slowFetch, now: () => t, budgets: { ...deps(m.store).budgets, timeMs: 2500 } }));
    expect(r.status).toBe('partial');
    const crawled = m.checks.filter((c) => c.source === 'crawl' && !(c.detail as { canary?: boolean }).canary).map((c) => c.url);
    expect(crawled.length).toBeGreaterThan(0);
    for (const s of STRATA) {
      const last = m.cur('crawl', s);
      if (last) expect(crawled).toContain(last); // a cursor only ever lands on an observed URL
    }
  });

  it('a Slack failure is recorded, not hidden', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store, { postSlack: async () => ({ ok: false, error: 'not_in_channel' }) }));
    expect(r.slack).toBe('failed');
    expect(m.runs[0].slack_state).toBe('failed');
    expect(String(m.runs[0].error)).toMatch(/not_in_channel/);
  });

  it('a store that cannot start a run fails fast and touches nothing', async () => {
    const m = memoryStore({ startRun: async () => { throw new Error('no db'); } });
    const r = await runSeoHealth(deps(m.store));
    expect(r).toMatchObject({ ok: false, status: 'failed', runId: null });
    expect(m.saves()).toBe(0);
  });
});
