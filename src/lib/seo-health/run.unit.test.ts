import { describe, expect, it } from 'vitest';
import { runSeoHealth, type RunDeps } from './run';
import type { SeoHealthStore } from './store';
import type { Cursor, Stream, UrlCheck } from './types';

const ORIGIN = 'https://getmindy.ai';
const PAGES = Array.from({ length: 12 }, (_, i) => `${ORIGIN}/contractors/c${String(i).padStart(2, '0')}`);
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

function memoryStore(overrides: Partial<SeoHealthStore> = {}) {
  const cursors: Record<Stream, Cursor> = { crawl: { stream: 'crawl', last_url: null, cycle: 0 }, inspect: { stream: 'inspect', last_url: null, cycle: 0 } };
  const checks: UrlCheck[] = [];
  const runs: Array<Record<string, unknown>> = [];
  let saves = 0;
  const store: SeoHealthStore = {
    startRun: async () => { runs.push({ status: 'running' }); return runs.length; },
    updateRun: async (id, patch) => { Object.assign(runs[id - 1], patch); },
    loadCursor: async (s) => ({ ...cursors[s] }),
    saveCursor: async (c) => { cursors[c.stream] = { ...c }; saves++; },
    insertChecks: async (_id, cs) => { checks.push(...cs); return new Set(cs.map((c) => c.url)); },
    upsertSectionDaily: async () => {},
    crawlHistory: async () => [],
    canaryHistory: async () => [],
    previousRunSummary: async () => null,
    sectionDaily: async () => [],
    inspections: async () => [],
    ...overrides,
  };
  return { store, cursors, checks, runs, saves: () => saves };
}

function deps(store: SeoHealthStore, over: Partial<RunDeps> = {}): RunDeps {
  return {
    fetch: siteFetch(),
    gsc: { datePageRows: async () => [], inspect: async () => ({ ok: true as const, result: { verdict: 'PASS', coverageState: 'Submitted and indexed' } }) },
    store,
    postSlack: async () => ({ ok: true }),
    now: Date.now,
    liveBqEnabled: () => false,
    budgets: { crawl: 5, inspect: 5 },
    ...over,
  };
}

describe('runSeoHealth', () => {
  it('a clean run observes, records, advances both cursors and posts', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store));
    expect(r.status).toBe('ok');
    expect(r.slack).toBe('posted');
    expect(m.cursors.crawl.last_url).toBe(PAGES[4]);
    expect(m.cursors.inspect.last_url).toBe(PAGES[4]);
    expect(m.runs[0].status).toBe('ok');
  });

  it('unreadable sitemap: run fails, cursors untouched, failure still reported', async () => {
    const m = memoryStore();
    let posted = '';
    const r = await runSeoHealth(deps(m.store, { fetch: siteFetch({ sitemapDown: true }), postSlack: async (t) => { posted = t; return { ok: true }; } }));
    expect(r.status).toBe('failed');
    expect(r.ok).toBe(false);
    expect(m.saves()).toBe(0);
    expect(m.cursors.crawl.last_url).toBeNull();
    expect(posted).toMatch(/failed/);
  });

  it('Google 429 mid-batch: inspection cursor stops before the unobserved URL, which is first next run', async () => {
    const m = memoryStore();
    let n = 0;
    const inspect = async () => (++n === 3 ? { ok: false as const, status: 429, error: 'quota' } : { ok: true as const, result: { verdict: 'PASS', coverageState: 'Submitted and indexed' } });
    const r = await runSeoHealth(deps(m.store, { gsc: { datePageRows: async () => [], inspect } }));
    expect(r.status).toBe('partial');
    expect(m.cursors.inspect.last_url).toBe(PAGES[1]); // PAGES[2] hit the 429
    const seen: string[] = [];
    await runSeoHealth(deps(m.store, { gsc: { datePageRows: async () => [], inspect: async (u) => { seen.push(u); return { ok: true as const, result: { verdict: 'PASS' } }; } } }));
    expect(seen[0]).toBe(PAGES[2]);
  });

  it('a permanent per-URL inspection error is recorded and moved past (it cannot block the rotation)', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store, { gsc: { datePageRows: async () => [], inspect: async () => ({ ok: false as const, status: 400, error: 'not in property' }) } }));
    expect(m.cursors.inspect.last_url).toBe(PAGES[4]);
    expect(m.checks.filter((c) => c.source === 'inspect').every((c) => c.outcome === 'inspection_error')).toBe(true);
    expect(r.status).toBe('ok');
  });

  it('results that could not be recorded do not move the cursor', async () => {
    const m = memoryStore({ insertChecks: async () => { throw new Error('db down'); } });
    const r = await runSeoHealth(deps(m.store));
    expect(r.status).toBe('partial');
    expect(m.cursors.crawl.last_url).toBeNull();
    expect(m.cursors.inspect.last_url).toBeNull();
  });

  it('time budget: only observed URLs commit, the rest resume next run', async () => {
    const m = memoryStore();
    let t = 0;
    const now = () => t;
    const slowFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sitemap-index.xml')) return siteFetch()(input);
      if (/\/contractors\/c\d+$/.test(url)) t += 1000; // each rotation page costs 1s of the 2.5s budget; canaries are free here
      return new Response(goodHtml(url), { status: 200 });
    }) as typeof fetch;
    const r = await runSeoHealth(deps(m.store, { fetch: slowFetch, now, budgets: { crawl: 5, inspect: 0, timeMs: 2500 } }));
    expect(r.status).toBe('partial');
    const committed = (r.summary.crawl as { committed: number }).committed;
    expect(committed).toBeGreaterThan(0);
    expect(committed).toBeLessThan(5);
    expect(m.cursors.crawl.last_url).toBe(PAGES[committed - 1]);
  });

  it('a store that cannot start a run fails fast and touches nothing', async () => {
    const m = memoryStore({ startRun: async () => { throw new Error('no db'); } });
    const r = await runSeoHealth(deps(m.store));
    expect(r).toMatchObject({ ok: false, status: 'failed', runId: null });
    expect(m.saves()).toBe(0);
  });

  it('a Slack failure is recorded, not hidden', async () => {
    const m = memoryStore();
    const r = await runSeoHealth(deps(m.store, { postSlack: async () => ({ ok: false, error: 'not_in_channel' }) }));
    expect(r.slack).toBe('failed');
    expect(m.runs[0].slack_state).toBe('failed');
    expect(String(m.runs[0].error)).toMatch(/not_in_channel/);
  });
});
