/**
 * Maps P0 (2026-09-24) — NEWEST ACTION WINS · PROGRESSIVE HORIZONS · HORIZON CACHE.
 *
 * BEHAVIORAL, not string-shape: the real fetch orchestration (fetchView → _fetchViewNow →
 * _loadHorizon → _paintRound, plus the real horizonCount / coverageNote / needsScopeNote) is
 * extracted from route.ts and RUN against a stubbed fetch whose per-URL latency we control. Every
 * render() snapshots OPPS, so "did a superseded response ever paint?" is a measured fact.
 *
 * The defect it pins (measured on prod 2026-09-24, tasks/maps-latency-transition-audit-2026-09-24.md):
 * "Start fresh" painted the OLD DoD-filtered results at 1.7 s and the right ones at 3.2 s. A restore
 * resets controls that each trigger a fetch before FILT is cleared, and the old busy/pendingFetch
 * queue let that first (stale) request land, then ran the real one serially.
 *
 * RED → GREEN: point MAPS_ROUTE_SRC at the pre-fix route (git show <base>:src/app/opportunity-map/route.ts)
 * and the "stale paint" cases fail; on the fixed route they pass.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');

/** Text the browser runs: the client JS lives in a TS template literal (backslashes doubled). */
function unTemplate(s: string) { return s.replace(/\\\\/g, '\\'); }
function extractFn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing ${name}`);
  let depth = 0; let j = src.indexOf('{', i);
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1);
}
function orchestrationBlock(src: string): string {
  const starts = ['  // ── MAPS P0 (2026-09-24): NEWEST ACTION WINS', '  // Duplicate-viewport guard state'];
  const s = starts.map((m) => src.indexOf(m)).find((i) => i >= 0);
  const e = src.indexOf('  // FOOT OF THE FEED: a standing link');
  if (s == null || s < 0 || e < 0) throw new Error('orchestration block not found');
  const afterFetch = (src.match(/  function afterFetch\(\)\{[^\n]*\n/) || [''])[0];   // pre-fix only
  return afterFetch + src.slice(s, e);
}

type Resp = { pins: Array<{ tag: string }>; totalForFilters: number; delay: number };
function harness(respond: (url: string) => Resp) {
  const calls: string[] = [];
  const paints: Array<{ tags: string[]; total: number }> = [];
  const win: Record<string, unknown> = { __horizons: { open: true, recompete: true, forecast: true }, __mapMode: 'open' };
  const ctx: Record<string, unknown> = {
    window: win, console, performance, Date, Math, JSON, String, Number, Array, Object, Promise, Error,
    setTimeout, clearTimeout, AbortController,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    FILT: { agency: '', naics: '', state: '', setAside: '', setAsideMulti: '' },
    MODES: { open: { ep: '/o' }, recompete: { ep: '/r' }, forecast: { ep: '/f' } },
    MODE: 'open', Q: '', HIDE_FSC: false, OPPS: [], TOTAL: 0, CAPPED: false, INVIEW: 0,
    busy: false, pendingFetch: false,
    BBOX: '-80,30,-70,40',
    bbox() { return ctx.BBOX as string; },
    isContactMode: () => false, _uemail: () => '', _trackMapView() {}, _clearFetchError() {}, _showFetchError() {},
    maybeJumpToSearch: () => false, maybeAutoFit() {}, _unplacedFoot() {},
    toRow: (p: { tag: string }) => ({ tag: p.tag }), unplacedToRow: (u: unknown) => u,
    render() { paints.push({ tags: (ctx.OPPS as Array<{ tag: string }>).map((o) => o.tag), total: ctx.TOTAL as number }); },
    fetch(url: string, init?: { signal?: AbortSignal }) {
      calls.push(url);
      const r = respond(url);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ json: async () => ({ success: true, discovery: {}, pins: r.pins, totalForFilters: r.totalForFilters, totalInView: r.pins.length, capped: false, unmappedForFilters: 0, ...(url.includes('counts=0') ? { countsSkipped: true, totalForFilters: undefined } : {}) }) }), r.delay);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
    },
  };
  win.window = win;
  vm.createContext(ctx);
  const code = [extractFn(SRC, 'horizonCount'), extractFn(SRC, 'horizonCountLabel'), extractFn(SRC, 'coverageNote'), extractFn(SRC, 'needsScopeNote'), orchestrationBlock(SRC)]
    .map(unTemplate).join('\n');
  vm.runInContext(code + '\n;this.__fetchView=fetchView;', ctx);
  return { ctx, calls, paints, fetchView: ctx.__fetchView as () => void };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const horizonOf = (url: string) => (url.startsWith('/o') ? 'open' : url.startsWith('/r') ? 'recompete' : 'forecast');

describe('newest action wins — a superseded request never paints', () => {
  it('"Start fresh": a stale-filter fetch fired in the SAME tick as the real one never paints (the prod defect)', async () => {
    const h = harness((url) => ({ pins: [{ tag: (url.includes('agency=') ? 'STALE-' : 'FRESH-') + horizonOf(url) }], totalForFilters: 1, delay: url.includes('agency=') ? 5 : 60 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: true, recompete: false, forecast: false };
    (h.ctx.FILT as Record<string, string>).agency = 'DEFENSE';
    h.fetchView();                                  // a control reset fires before FILT is cleared…
    (h.ctx.FILT as Record<string, string>).agency = '';
    h.fetchView();                                  // …then the restorer's own fetch with the real intent
    await sleep(600);
    const stale = h.paints.filter((p) => p.tags.some((t) => t.startsWith('STALE')));
    expect(stale).toEqual([]);
    expect(h.paints.at(-1)!.tags).toEqual(['FRESH-open']);
    expect(h.calls.filter((c) => c.includes('agency='))).toEqual([]);   // collapsed: never even sent
  });

  it('a slow older request is aborted and never paints once a newer action lands (cross-tick)', async () => {
    const h = harness((url) => ({ pins: [{ tag: url.includes('agency=') ? 'OLD' : 'NEW' }], totalForFilters: 1, delay: url.includes('agency=') ? 400 : 20 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: true, recompete: false, forecast: false };
    (h.ctx.FILT as Record<string, string>).agency = 'DEFENSE';
    h.fetchView();
    await sleep(15);                                // the old request is in flight
    (h.ctx.FILT as Record<string, string>).agency = '';
    h.fetchView();
    await sleep(900);
    expect(h.paints.some((p) => p.tags.includes('OLD'))).toBe(false);
    expect(h.paints.at(-1)!.tags).toEqual(['NEW']);
  });
});

describe('progressive horizons — no horizon waits for the slowest', () => {
  it('Open paints as soon as it lands; Recompete joins later; the slow one reads "loading", never a number', async () => {
    const h = harness((url) => ({ pins: [{ tag: horizonOf(url) }], totalForFilters: 10, delay: horizonOf(url) === 'recompete' ? 700 : 10 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: true, recompete: true, forecast: false };
    h.fetchView();
    await sleep(250);
    expect(h.paints.length).toBeGreaterThan(0);
    expect(h.paints[0].tags).toEqual(['open']);
    const counts = (h.ctx.window as Record<string, Record<string, { state: string }>>).__horizonCounts;
    expect(counts.recompete.state).toBe('loading');
    await sleep(900);
    expect(h.paints.at(-1)!.tags.sort()).toEqual(['open', 'recompete']);
    expect(h.paints.at(-1)!.total).toBe(20);
  });
});

describe('horizon cache — keyed by intent + bbox, market truth by intent only', () => {
  it('turning a horizon OFF makes ZERO requests and repaints from what is already held', async () => {
    const h = harness((url) => ({ pins: [{ tag: horizonOf(url) }], totalForFilters: 5, delay: 10 }));
    h.fetchView();
    await sleep(300);
    const before = h.calls.length;
    (h.ctx.window as Record<string, Record<string, boolean>>).__horizons.open = false;
    h.fetchView();
    await sleep(150);
    expect(h.calls.length).toBe(before);
    expect(h.paints.at(-1)!.tags.sort()).toEqual(['forecast', 'recompete']);
  });

  it('turning an unchanged horizon back ON reuses the cached result (no request)', async () => {
    const h = harness((url) => ({ pins: [{ tag: horizonOf(url) }], totalForFilters: 5, delay: 10 }));
    h.fetchView(); await sleep(300);
    (h.ctx.window as Record<string, Record<string, boolean>>).__horizons.open = false; h.fetchView(); await sleep(150);
    const before = h.calls.length;
    (h.ctx.window as Record<string, Record<string, boolean>>).__horizons.open = true; h.fetchView(); await sleep(150);
    expect(h.calls.length).toBe(before);
    expect(h.paints.at(-1)!.tags.sort()).toEqual(['forecast', 'open', 'recompete']);
  });

  it('a PAN with an unchanged intent asks for pins only (counts=0) and keeps the market total', async () => {
    const h = harness((url) => ({ pins: [{ tag: horizonOf(url) }], totalForFilters: 7, delay: 10 }));
    h.fetchView(); await sleep(300);
    const before = h.calls.length;
    h.ctx.BBOX = '-90,30,-80,40';                     // the map moved; the search did not
    h.fetchView(); await sleep(300);
    const pan = h.calls.slice(before);
    expect(pan).toHaveLength(3);
    expect(pan.every((u) => u.includes('counts=0'))).toBe(true);
    expect(h.paints.at(-1)!.total).toBe(21);          // 3 × 7 from the held market truth, not 0/undefined
  });

  it('a NEW intent (search/filter change) recomputes market truth — never reuses another intent\'s counts', async () => {
    const h = harness((url) => ({ pins: [{ tag: horizonOf(url) }], totalForFilters: url.includes('naics=') ? 2 : 7, delay: 10 }));
    h.fetchView(); await sleep(300);
    const before = h.calls.length;
    (h.ctx.FILT as Record<string, string>).naics = '541512';
    h.fetchView(); await sleep(300);
    const next = h.calls.slice(before);
    expect(next.some((u) => u.includes('counts=0'))).toBe(false);
    expect(h.paints.at(-1)!.total).toBe(6);
  });
});
