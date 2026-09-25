/**
 * #1692 × Maps P0/P1 INTEGRATION — the vehicle/parent scope running inside the P0 fetch engine.
 *
 * BEHAVIORAL: the real orchestration (fetchView → _fetchViewNow → _loadHorizon → _paintRound, plus the
 * real _buildOppUrl, horizonCount and the scope isolation) is extracted from route.ts and RUN against a
 * fetch stub whose bodies and latencies each test controls — the same harness shape as
 * newest-action-wins.unit.test.ts. Every render() and every scope-banner render is recorded.
 *
 * Risks pinned (from the reconcile of #1692 with #1684/#1693):
 *   1. A scoped search loads ONLY Awarded; Open/Forecast never enter the headline, even when their
 *      requests were already in flight when the scope was applied.
 *   2. Cached market truth belongs to the EXACT scope + filters: changing vehicle, parent, work or a
 *      filter never reuses another search's counts; a pan of the same intent does (counts=0).
 *   3. A count-skipping response means "not supplied" — never zero; the banner survives pans and
 *      progressive loading, hides while a NEW scope loads, and a superseded answer never sets it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');
const unTemplate = (s: string) => s.replace(/\\\\/g, '\\');
function extractFn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing ${name}`);
  let depth = 0; let j = src.indexOf('{', i);
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1);
}
function orchestrationBlock(src: string): string {
  const s = src.indexOf('  // ── MAPS P0 (2026-09-24): NEWEST ACTION WINS');
  const e = src.indexOf('  // FOOT OF THE FEED: a standing link');
  if (s < 0 || e < 0) throw new Error('orchestration block not found');
  return src.slice(s, e);
}

type Body = Record<string, unknown>;
/** A recompete-map body, the way buildRecompeteMapBody shapes it (counts omitted on counts=0). */
function awarded(url: string, over: { pins: string[]; total: number; unmapped: number; scope?: string | null }): Body {
  const q = new URL('http://x' + url).searchParams;
  const skip = q.get('counts') === '0';
  const scoped = !!(q.get('vehicle') || q.get('parent') || q.get('work'));
  return {
    success: true, mode: 'recompete', discovery: { status: 'ok' },
    ...(skip ? { countsSkipped: true } : { totalForFilters: over.total, unmappedForFilters: over.unmapped }),
    totalInView: over.pins.length, capped: false, pins: over.pins.map((tag) => ({ tag })),
    ...(scoped ? { vehicle_scope: { status: 'resolved', label: over.scope ?? `${q.get('vehicle') || q.get('parent')}|${q.get('work') || ''}` } } : {}),
  };
}

function harness(respond: (url: string) => { body: Body; delay: number }) {
  const calls: string[] = [];
  const paints: Array<{ tags: string[]; total: number }> = [];
  const banners: Array<string | null> = [];
  const win: Record<string, unknown> = { __horizons: { open: true, recompete: true, forecast: true }, __mapMode: 'open' };
  win.__renderVehicleScope = () => { const vs = win.__vehicleScope as { label?: string } | null; banners.push(vs ? String(vs.label) : null); };
  const FILT: Record<string, unknown> = { agency: '', naics: '', state: '', setAside: '', setAsideMulti: '', vehicle: '', parent: '', work: '', leadMax: '', valueRange: '' };
  const ctx: Record<string, unknown> = {
    window: win, console, performance, Date, Math, JSON, String, Number, Array, Object, Promise, Error, URL,
    setTimeout, clearTimeout, AbortController,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    FILT, MODES: { open: { ep: '/o' }, recompete: { ep: '/r' }, forecast: { ep: '/f' } },
    MODE: 'open', Q: '', HIDE_FSC: false, OPPS: [], TOTAL: 0, CAPPED: false, INVIEW: 0,
    busy: false, pendingFetch: false, BBOX: '-80,30,-70,40',
    bbox() { return ctx.BBOX as string; },
    isContactMode: () => false, _uemail: () => '', _trackMapView() {}, _clearFetchError() {}, _showFetchError() {},
    maybeJumpToSearch: () => false, maybeAutoFit() {}, _unplacedFoot() {},
    toRow: (p: { tag: string }) => ({ tag: p.tag }), unplacedToRow: (u: unknown) => u,
    render() { paints.push({ tags: (ctx.OPPS as Array<{ tag: string }>).map((o) => o.tag), total: ctx.TOTAL as number }); },
    fetch(url: string, init?: { signal?: AbortSignal }) {
      calls.push(url);
      const r = respond(url);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ json: async () => r.body }), r.delay);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
    },
  };
  win.window = win;
  vm.createContext(ctx);
  const code = [extractFn(SRC, 'horizonCount'), extractFn(SRC, 'horizonCountLabel'), extractFn(SRC, 'coverageNote'), extractFn(SRC, 'needsScopeNote'), orchestrationBlock(SRC)]
    .map(unTemplate).join('\n');
  vm.runInContext(code + '\n;this.__fetchView=fetchView;', ctx);
  const w = win as { __horizonCounts: Record<string, { state: string; total: number | null }>; __vehicleScope: { label: string } | null };
  return { ctx, FILT, calls, paints, banners, w, fetchView: ctx.__fetchView as (o?: { pan?: boolean }) => void };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hz = (url: string) => (url.startsWith('/o') ? 'open' : url.startsWith('/r') ? 'recompete' : 'forecast');
const other = (url: string): { body: Body; delay: number } => ({
  body: { success: true, discovery: { status: 'ok' }, totalForFilters: 5000, unmappedForFilters: 100, totalInView: 1, capped: false, pins: [{ tag: hz(url).toUpperCase() }] }, delay: 30,
});

describe('1 — a scoped search loads ONLY Awarded; Open/Forecast never reach the headline', () => {
  it('only the Awarded endpoint is requested, and the headline is exactly the scoped total', async () => {
    const h = harness((url) => (hz(url) === 'recompete' ? { body: awarded(url, { pins: ['S1', 'S2'], total: 15, unmapped: 8 }), delay: 20 } : other(url)));
    h.FILT.vehicle = 'OASIS+'; h.FILT.work = 'management consulting';
    h.fetchView();
    await sleep(200);
    expect(h.calls.every((u) => hz(u) === 'recompete')).toBe(true);
    expect(h.calls[0]).toContain('vehicle=OASIS');
    expect(h.paints.at(-1)).toEqual({ tags: ['S1', 'S2'], total: 15 });
    expect(Object.keys(h.w.__horizonCounts)).toEqual(['recompete']);
  });
  it('Open/Forecast requests already IN FLIGHT when the scope is applied are aborted and never paint or count', async () => {
    const h = harness((url) => (hz(url) === 'recompete'
      ? { body: awarded(url, { pins: url.includes('vehicle=') ? ['S1'] : ['BROAD'], total: url.includes('vehicle=') ? 15 : 100000, unmapped: 8 }), delay: 60 }
      : { ...other(url), delay: 80 }));
    h.fetchView();                              // an unscoped round: all three horizons in flight
    await sleep(10);
    h.FILT.vehicle = 'OASIS+';
    h.fetchView();                              // the scope lands before any of them answered
    await sleep(400);
    expect(h.paints.some((p) => p.tags.includes('OPEN') || p.tags.includes('FORECAST') || p.tags.includes('BROAD'))).toBe(false);
    expect(h.paints.at(-1)).toEqual({ tags: ['S1'], total: 15 });
  });
});

describe('1b — DLA mode is its own map: a leftover scope never turns it into the Awarded market (integration review blocker)', () => {
  it('scope set, DLA tab: DLA fetches its own endpoint, no Awarded request, no scope params, no banner', async () => {
    const h = harness((url) => (hz(url) === 'recompete' ? { body: awarded(url, { pins: ['AWARDED'], total: 99, unmapped: 0 }), delay: 10 } : { body: { success: true, discovery: { status: 'ok' }, totalForFilters: 7, unmappedForFilters: 0, totalInView: 1, capped: false, pins: [{ tag: 'DLA' }] }, delay: 10 }));
    h.FILT.vehicle = 'OASIS+'; h.FILT.work = 'management consulting';
    h.fetchView(); await sleep(100);                                   // the scoped Opportunities map
    expect(h.w.__vehicleScope).not.toBeNull();
    const n = h.calls.length;
    (h.ctx.window as Record<string, unknown>).__mapMode = 'dla';       // the user clicks the DLA tab (FILT untouched)
    h.fetchView(); await sleep(150);
    const dla = h.calls.slice(n);
    expect(dla.length).toBeGreaterThan(0);
    expect(dla.some((u) => hz(u) === 'recompete')).toBe(false);
    expect(dla.some((u) => /[?&](vehicle|parent|work)=/.test(u))).toBe(false);
    expect(h.paints.at(-1)).toEqual({ tags: ['DLA'], total: 7 });
    expect(h.w.__vehicleScope).toBeNull();
    (h.ctx.window as Record<string, unknown>).__mapMode = 'open';      // back to Opportunities: the scope is still the user's
    const m = h.calls.length;
    h.fetchView(); await sleep(150);
    // Served from the P0 pins/truth cache (same scoped URL, within the TTL) — any request it does make is scoped.
    expect(h.calls.slice(m).every((u) => hz(u) === 'recompete' && u.includes('vehicle=OASIS'))).toBe(true);
    expect(h.paints.at(-1)).toEqual({ tags: ['AWARDED'], total: 99 });
    expect(h.w.__vehicleScope).not.toBeNull();
  });
});

describe('2 — cached counts belong to the EXACT scope and filters', () => {
  const totals: Record<string, number> = { 'OASIS+|management consulting': 15, 'OASIS+|program management': 40, 'CONT_IDV_X_4732|management consulting': 3, 'OASIS+|management consulting|1000000': 6 };
  const keyOf = (url: string) => { const q = new URL('http://x' + url).searchParams; return [q.get('vehicle') || q.get('parent'), q.get('work') || '', q.get('minValue') || ''].filter((x, i) => i < 2 || x).join('|'); };
  const respond = (url: string) => ({ body: awarded(url, { pins: [keyOf(url)], total: totals[keyOf(url)] ?? -1, unmapped: 1, scope: keyOf(url) }), delay: 15 });

  it('a pan of the same scope reuses its counts (counts=0) — each changed scope/filter asks for its own', async () => {
    const h = harness(respond);
    (h.ctx.window as Record<string, unknown>).__horizons = { open: false, recompete: true, forecast: false };
    h.FILT.vehicle = 'OASIS+'; h.FILT.work = 'management consulting';
    h.fetchView(); await sleep(120);
    expect(h.paints.at(-1)!.total).toBe(15);

    h.ctx.BBOX = '-90,25,-60,45'; h.fetchView({ pan: true }); await sleep(120);        // pan: same intent
    expect(h.calls.at(-1)).toContain('counts=0');
    expect(h.paints.at(-1)!.total).toBe(15);                                          // cached truth, not 0

    const steps: Array<[() => void, number]> = [
      [() => { h.FILT.work = 'program management'; }, 40],                             // work terms
      [() => { h.FILT.vehicle = ''; h.FILT.parent = 'CONT_IDV_X_4732'; h.FILT.work = 'management consulting'; }, 3], // vehicle → parent
      [() => { h.FILT.parent = ''; h.FILT.vehicle = 'OASIS+'; h.FILT.valueRange = '1000000-'; }, 6],                 // a filter
    ];
    for (const [change, want] of steps) {
      change(); h.fetchView(); await sleep(120);
      expect(h.calls.at(-1)).not.toContain('counts=0');                               // a new intent is COUNTED
      expect(h.paints.at(-1)!.total).toBe(want);
    }
    h.FILT.valueRange = ''; h.fetchView(); await sleep(120);                           // back to scope A at the new bbox
    expect(h.paints.at(-1)!.total).toBe(15);                                          // A's own counts — not the last scope's
  });
});

describe('3 — counts=0 means "not supplied", never zero; the banner follows the CURRENT scope', () => {
  it('a count-skipping pan keeps the cached count and unmapped (never 0/unknown) and keeps the banner', async () => {
    const h = harness((url) => ({ body: awarded(url, { pins: ['S1'], total: 15, unmapped: 8 }), delay: 15 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: false, recompete: true, forecast: false };
    h.FILT.vehicle = 'OASIS+';
    h.fetchView(); await sleep(100);
    const bannerBefore = h.banners.length;
    h.ctx.BBOX = '-100,20,-60,50'; h.fetchView({ pan: true }); await sleep(100);
    expect(h.calls.at(-1)).toContain('counts=0');
    expect(h.paints.at(-1)!.total).toBe(15);
    expect(h.w.__horizonCounts.recompete).toMatchObject({ state: 'ok', total: 15 });
    expect(h.banners.slice(bannerBefore).every((b) => b !== null)).toBe(true);        // never hidden by a pan
    expect(h.w.__vehicleScope?.label).toBe('OASIS+|');
  });
  it('a NEW scope hides the previous banner while loading; a superseded answer never sets it', async () => {
    const h = harness((url) => ({ body: awarded(url, { pins: ['x'], total: 1, unmapped: 0 }), delay: url.includes('vehicle=A') ? 150 : 40 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: false, recompete: true, forecast: false };
    h.FILT.vehicle = 'B'; h.fetchView(); await sleep(100);
    expect(h.w.__vehicleScope?.label).toBe('B|');
    h.FILT.vehicle = 'A'; h.fetchView(); await sleep(10);                               // A is slow…
    expect(h.w.__vehicleScope).toBeNull();                                             // …B's text is not shown for A
    h.FILT.vehicle = 'C'; h.fetchView(); await sleep(300);                              // user moves on before A answers
    expect(h.w.__vehicleScope?.label).toBe('C|');
    expect(h.banners).not.toContain('A|');                                             // A's late answer never painted the banner
  });
  it('an UNRESOLVED scope reads as needs-refinement — no number, not 0', async () => {
    const h = harness(() => ({ body: { success: true, mode: 'recompete', discovery: { status: 'needs_refinement', refinement: 'ambiguous' }, vehicle_scope: { status: 'unresolved', label: 'OASIS' }, totalForFilters: null, totalInView: null, capped: false, unmappedForFilters: null, pins: [] }, delay: 10 }));
    (h.ctx.window as Record<string, unknown>).__horizons = { open: false, recompete: true, forecast: false };
    h.FILT.vehicle = 'OASIS'; h.fetchView(); await sleep(100);
    expect(h.w.__horizonCounts.recompete.state).toBe('needs_scope');
    expect(h.w.__horizonCounts.recompete.total).toBeNull();
  });
  it('clearing the scope brings the other horizons back and clears the banner', async () => {
    const h = harness((url) => (hz(url) === 'recompete' ? { body: awarded(url, { pins: ['R'], total: 9, unmapped: 0 }), delay: 10 } : other(url)));
    h.FILT.vehicle = 'OASIS+'; h.fetchView(); await sleep(100);
    expect(h.w.__vehicleScope).not.toBeNull();
    h.FILT.vehicle = ''; h.fetchView(); await sleep(200);
    expect(new Set(h.calls.slice(-3).map(hz))).toEqual(new Set(['open', 'recompete', 'forecast']));
    expect(h.w.__vehicleScope).toBeNull();
  });
});
