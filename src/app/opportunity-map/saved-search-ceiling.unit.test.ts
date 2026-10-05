/**
 * The 8-second boundary of a ?ss= saved-search link — executed end to end.
 *
 * The REAL fetch orchestration (fetchView → _fetchViewNow → _loadHorizon → render, with
 * newest-action-wins) and the REAL ?ss= handler run together in one VM on fake timers. Every
 * render() is recorded with the status pill AS IT READS AT THAT MOMENT, so these are measured
 * facts, not inferences:
 *   1. no unfiltered result is ever painted while the pill names the saved search;
 *   2. a lookup that succeeds after the 8 s ceiling still applies, and the default round still in
 *      flight never paints over it;
 *   3. a lookup that never answers leaves an honestly-labelled full map, then a visible error;
 *   4. a late answer never overwrites a market the reader has changed since (another saved search,
 *      a filter) — it waits for consent;
 *   5. "Show the full map" cancels: a later answer does nothing.
 *
 * Only the restorer is a stub here (it sets FILT + horizons and calls fetchView, as the real one
 * does); the real restorer is executed in saved-search-restore-semantics.unit.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');
const unT = (s: string) => s.replace(/\\\\/g, '\\');
function extractFn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing ${name}`);
  let depth = 0; let j = src.indexOf('{', i);
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1);
}
function orchestration(): string {
  const s = SRC.indexOf('  // ── MAPS P0 (2026-09-24): NEWEST ACTION WINS');
  const e = SRC.indexOf('  // FOOT OF THE FEED: a standing link');
  if (s < 0 || e < 0) throw new Error('orchestration block not found');
  return SRC.slice(s, e);
}
function ssHandler(): string {
  const at = SRC.indexOf("var m=(location.search||'').match(/[?&]ss=([^&]+)/)");
  return SRC.slice(SRC.lastIndexOf('(function(){ try{', at), SRC.indexOf('  // Deep-link: scope params', at));
}

const SS_ID = '6e376442-819e-420f-b149-ef62861814ca';
const NAME = 'Atlantic Craft Partners JV — Navy Shipbuilding & Small Craft';
const ROW = { id: SS_ID, name: NAME, mode: 'open', filters: { naics: '336611,336612', agency: 'DEFENSE', status: 'active' }, bbox: null };

type Paint = { t: number; tags: string[]; pill: string | null; pillText: string };

function harness(opts: { lookupAt: number | null; mapDelay: number }) {
  const t0 = Date.now();
  const paints: Paint[] = [];
  const applies: unknown[] = [];
  const byId: Record<string, FakeEl> = {};
  class FakeEl {
    id = ''; children: FakeEl[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {};
    textContent = ''; className = ''; type = ''; onclick: null | (() => void) = null; parent: FakeEl | null = null;
    hidden = false;
    set innerHTML(_v: string) { this.children = []; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    getAttribute(k: string) { return this.attrs[k] ?? null; }
    appendChild(c: FakeEl) { c.parent = this; this.children.push(c); if (c.id) byId[c.id] = c; return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); if (this.id) delete byId[this.id]; }
    get text(): string { return [this.textContent, ...this.children.map((c) => c.text)].join(' ').trim(); }
  }
  const body = new FakeEl();
  const pillEl = () => byId.ssNotice || null;
  const all = (e: FakeEl | null): FakeEl[] => (e ? [e, ...e.children.flatMap(all)] : []);
  const win: Record<string, unknown> = {
    __horizons: { open: true, recompete: true, forecast: true }, __mapMode: 'open',
    __track() {}, addEventListener() {},
    __mapSession: () => ({ t: 'tok', em: 'reader@example.test' }),
  };
  const tagOf = (url: string) => (url.includes('naics=336611') ? 'SAVED' : url.includes('naics=541512') ? 'USER' : 'UNFILTERED');
  const ctx: Record<string, unknown> = {
    window: win, console, performance, Math, JSON, String, Number, Array, Object, Promise, Error, AbortController,
    Date: globalThis.Date,
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (h: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(h),
    location: { search: `?ss=${SS_ID}&src=saved_search_alert`, pathname: '/opportunity-map', href: '' },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      body, createElement: () => new FakeEl(), createTextNode: (t: string) => Object.assign(new FakeEl(), { textContent: t }), getElementById: (id: string) => byId[id] || null,
      querySelector: (sel: string) => (sel === '.app' ? body : null), querySelectorAll: () => [], addEventListener() {},
    },
    FILT: { agency: '', naics: '', state: '', setAside: '', setAsideMulti: '' },
    MODES: { open: { ep: '/o' }, recompete: { ep: '/r' }, forecast: { ep: '/f' } },
    MODE: 'open', Q: '', HIDE_FSC: false, OPPS: [], TOTAL: 0, CAPPED: false, INVIEW: 0, busy: false, pendingFetch: false,
    bbox: () => '-125,24,-66,50',
    isContactMode: () => false, _uemail: () => '', _trackMapView() {}, _clearFetchError() {}, _showFetchError() {},
    maybeJumpToSearch: () => false, maybeAutoFit() {}, _unplacedFoot() {},
    toRow: (p: { tag: string }) => ({ tag: p.tag }), unplacedToRow: (u: unknown) => u,
    render() {
      const el = pillEl();
      paints.push({ t: Date.now() - t0, tags: (ctx.OPPS as Array<{ tag: string }>).map((o) => o.tag),
        pill: el ? el.getAttribute('data-state') : null, pillText: el ? el.text : '' });
    },
    fetch(url: string, init?: { signal?: AbortSignal }) {
      if (url.startsWith('/api/app/saved-searches')) {
        if (opts.lookupAt == null) return new Promise(() => {});
        const wait = Math.max(0, opts.lookupAt - (Date.now() - t0));
        return new Promise((resolve) => globalThis.setTimeout(() => resolve({ status: 200, ok: true, json: async () => ({ success: true, search: ROW }) }), wait));
      }
      const tag = tagOf(url);
      return new Promise((resolve, reject) => {
        const h = globalThis.setTimeout(() => resolve({ json: async () => ({ success: true, discovery: {}, pins: [{ tag }], totalForFilters: 1, totalInView: 1, capped: false, unmappedForFilters: 0 }) }), opts.mapDelay);
        init?.signal?.addEventListener('abort', () => { globalThis.clearTimeout(h); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
    },
  };
  win.window = win;
  vm.createContext(ctx);
  const code = [extractFn(SRC, 'horizonCount'), extractFn(SRC, 'horizonCountLabel'), extractFn(SRC, 'coverageNote'), extractFn(SRC, 'needsScopeNote'), orchestration()].map(unT).join('\n');
  vm.runInContext(`${code}
    window.__mapRefetch=function(o){ fetchView(o); };
    window.__mapIntentSig=function(){ var h=window.__horizons; return JSON.stringify({n:FILT.naics,a:FILT.agency,h:[h.open,h.recompete,h.forecast]}); };
    window.__applySavedSearch=function(ss){ __applies.push(ss.id); FILT.naics=ss.filters.naics; FILT.agency=ss.filters.agency;
      window.__horizons={open:true,recompete:false,forecast:false}; fetchView(); return {unsupported:[]}; };
    this.__fetchView=fetchView;
    this.__userPicks=function(naics){ FILT.naics=naics; FILT.agency=''; fetchView(); };
  `.replace('__applies', '__appliesRef'), Object.assign(ctx, { __appliesRef: applies }));
  // BOOT_VIEW_JS order: the hold is set from the URL, boot releases round 1 (deferred), handler runs.
  const hold = SRC.match(/  window\.__ssPending=[^\n]*\n  window\.__ssOwnsView=window\.__ssPending;\n/);
  if (hold) vm.runInContext(unT(hold[0]), ctx);
  vm.runInContext(unT(ssHandler()), ctx);
  globalThis.setTimeout(() => (ctx.__fetchView as (o: unknown) => void)({ system: true }), 50);   // boot release
  return {
    paints, applies,
    pill: () => pillEl()?.getAttribute('data-state') ?? null,
    pillText: () => pillEl()?.text ?? '',
    click: (act: string) => all(pillEl()).find((c) => c.getAttribute('data-act') === act)?.onclick?.(),
    userPicks: (naics: string) => (ctx.__userPicks as (n: string) => void)(naics),
  };
}
const only = (p: Paint | undefined, tag: string) => !!p && p.tags.length > 0 && p.tags.every((t) => t === tag);
const at = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
/** Rule 1, checked on EVERY paint: an unfiltered paint never sits under the saved search's name. */
function noUnfilteredUnderSavedName(paints: Paint[]) {
  for (const p of paints) {
    if (p.tags.some((t) => t !== 'SAVED')) {
      expect(p.pill).not.toBe('applied');
      expect(p.pillText).not.toContain('Atlantic Craft');
    }
  }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('lookup succeeds AFTER the 8 s ceiling', () => {
  it('the default round still in flight never paints over the late restore', async () => {
    const h = harness({ lookupAt: 9000, mapDelay: 1500 });       // default dispatched at 8 s, answers at 9.5 s
    await at(7900);
    expect(h.paints).toEqual([]);                                 // round 1 held for the saved search
    expect(h.pill()).toBe('loading');
    await at(400);
    expect(h.pill()).toBe('slow');                                // released — and says it is NOT filtered
    await at(4000);
    expect(h.applies).toEqual([SS_ID]);
    expect(h.paints.some((p) => p.tags.includes('UNFILTERED'))).toBe(false);   // stale default dropped
    expect(h.paints.at(-1)).toMatchObject({ tags: ['SAVED'], pill: 'applied' });
    noUnfilteredUnderSavedName(h.paints);
  });

  it('a default round that lands BEFORE the late lookup is labelled "not filtered", then replaced', async () => {
    const h = harness({ lookupAt: 9000, mapDelay: 300 });         // default paints at 8.3 s
    await at(13000);
    const unfiltered = h.paints.filter((p) => p.tags.includes('UNFILTERED'));
    expect(unfiltered.length).toBeGreaterThan(0);
    expect(unfiltered.every((p) => p.pill === 'slow' && /Showing all opportunities/.test(p.pillText))).toBe(true);
    expect(h.paints.at(-1)).toMatchObject({ tags: ['SAVED'], pill: 'applied' });
    noUnfilteredUnderSavedName(h.paints);
  });
});

describe('lookup never resolves', () => {
  it('honest full map at 8 s, visible error at 15 s, and never the saved name', async () => {
    const h = harness({ lookupAt: null, mapDelay: 200 });
    await at(7900);
    expect(h.paints).toEqual([]);
    await at(1000);
    expect(only(h.paints.at(-1), 'UNFILTERED')).toBe(true);
    expect(h.paints.at(-1)!.pill).toBe('slow');
    await at(7000);
    expect(h.pill()).toBe('error');
    expect(h.applies).toEqual([]);
    noUnfilteredUnderSavedName(h.paints);
  });
});

describe('a late response after the reader switched', () => {
  it('after the ceiling: picking another search wins; the late answer waits for consent', async () => {
    const h = harness({ lookupAt: 9000, mapDelay: 100 });
    await at(8600);
    h.userPicks('541512');                                        // another saved search / a filter
    await at(2000);
    expect(h.applies).toEqual([]);                                // NOT overwritten
    expect(h.pill()).toBe('superseded');
    expect(only(h.paints.at(-1), 'USER')).toBe(true);
    expect(h.paints.some((p) => p.tags.includes('SAVED'))).toBe(false);
    h.click('apply');                                             // ...and it is one click away
    await at(500);
    expect(h.applies).toEqual([SS_ID]);
    expect(h.paints.at(-1)).toMatchObject({ tags: ['SAVED'], pill: 'applied' });
    noUnfilteredUnderSavedName(h.paints);
  });

  it('during the hold: the reader’s change is kept, its round runs, the saved search is not forced', async () => {
    const h = harness({ lookupAt: 4000, mapDelay: 100 });
    await at(3000);
    h.userPicks('541512');                                        // deferred while held
    await at(2000);
    expect(h.applies).toEqual([]);
    expect(h.pill()).toBe('superseded');
    expect(only(h.paints.at(-1), 'USER')).toBe(true);
    h.click('keep');                                              // "Keep my changes"
    await at(20000);
    expect(h.applies).toEqual([]);
    expect(only(h.paints.at(-1), 'USER')).toBe(true);
  });

  it('"Show the full map" while loading cancels — a later answer does nothing', async () => {
    const h = harness({ lookupAt: 4000, mapDelay: 100 });
    await at(1000);
    h.click('cancel');                                            // "Show all opportunities"
    await at(10000);
    expect(h.applies).toEqual([]);
    expect(h.pill()).toBe('all');                                 // labelled as the full map, not the search
    expect(h.pillText()).toContain('Showing all opportunities');
    expect(only(h.paints.at(-1), 'UNFILTERED')).toBe(true);       // the full map the reader chose
  });
});
