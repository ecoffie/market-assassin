/**
 * ONE WRITER for a Today's Lens link (Joseph Boyd, 2026-10-25).
 *
 * The lens link now carries ?strategy=…&naics=… (todays-lens-link.ts). Two map handlers read those
 * params: the scope-link IIFE (naics/agency/…) and the standalone ?strategy= IIFE. If both wrote the
 * filters, the scope restore's FILT reset could drop the strands after the strategy handler applied
 * them — the same two-writer race that once took the map 5,416 → 0. These tests EXECUTE the real
 * handler source extracted from route.ts (cooked from the TS template literal) against a fake DOM and
 * count which handler writes:
 *   · lens link with a scope  → __applySavedSearch exactly once, carrying naics AND strategy
 *                               (opts.strategy); __applyStrategyBoxes NEVER.
 *   · strategy-only link      → unchanged legacy path: __applyStrategyBoxes once, no scope restore.
 *   · naics-only / ?opp= link → the strategy handler does nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const cook = (s: string) => s.replace(/\\\\/g, '\\');

function slice(startMarker: string, endMarker: string, from = 0): string {
  const a = MAP.indexOf(startMarker, from);
  expect(a, `missing start: ${startMarker.slice(0, 60)}`).toBeGreaterThan(-1);
  const b = MAP.indexOf(endMarker, a);
  expect(b, `missing end: ${endMarker.slice(0, 60)}`).toBeGreaterThan(a);
  return cook(MAP.slice(a, b + endMarker.length));
}

const PREDICATE = slice('window.__scopeLinkPresent=function(){', '  };\n');
const SCOPE_IIFE = slice("  (function(){ try{\n    function P(k){ var m=(location.search||'')", "  }catch(e){} })();\n");
const STRATEGY_IIFE = slice(
  "  (function(){ try{\n    var m=(location.search||'').match(/[?&]strategy=([^&]+)/); if(!m)return;",
  "    })();\n  }catch(e){} })();\n",
);

const STRANDS = ['repeat_buyer', 'sb_friendly', 'sources_sought', 'closes_soon', 'set_aside'];
const LABELS: Record<string, string> = {
  repeat_buyer: 'Repeat Buyer', sb_friendly: 'SB-Friendly', sources_sought: 'Shapeable', closes_soon: 'Close This Week', set_aside: 'Set-Aside',
};

type El = { id?: string; style: Record<string, string>; textContent: string; children: El[]; attrs: Record<string, string>;
  appendChild(c: El): El; setAttribute(k: string, v: string): void; remove(): void; onclick?: () => void };

function run(search: string, env: { totals?: Record<string, unknown>; lensFilters?: { strategy: string; naics: string } } = {}) {
  const boxes = STRANDS.map((v) => ({ value: v, checked: false, parentNode: { textContent: LABELS[v] } }));
  const byId: Record<string, El> = {};
  const mk = (): El => {
    const el: El = { style: {}, textContent: '', children: [], attrs: {},
      appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      remove() { if (this.id) delete byId[this.id]; } };
    return new Proxy(el, { set(t, k, v) { (t as unknown as Record<string | symbol, unknown>)[k] = v; if (k === 'id') byId[v as string] = t; return true; } });
  };
  const body = mk();
  const document = {
    querySelectorAll(sel: string) {
      if (sel === '.mf-strategy') return boxes;
      if (sel === '.mf-strategy:checked') return boxes.filter((b) => b.checked);
      return [];
    },
    querySelector(sel: string) {
      const m = sel.match(/^\.mf-strategy\[value="([^"]+)"\]$/);
      if (m) return boxes.find((b) => b.value === m[1]) || null;
      return null;                       // .mapwrap absent → body
    },
    getElementById: (id: string) => byId[id] || null,
    createElement: () => mk(),
    body,
  };
  type Ss = { mode: string; filters: Record<string, unknown> };
  const calls = { applySaved: [] as { ss: Ss; opts: Record<string, unknown> | undefined }[], applyBoxes: 0 };
  const timers: (() => void)[] = [];
  const win: Record<string, unknown> = {
    __mapMode: 'open',
    __AGENCY_PRESETS: [],
    __isolateHorizon: () => {},
    __applySavedSearch: (ss: Ss, opts?: Record<string, unknown>) => {
      calls.applySaved.push({ ss, opts });
      // Mirrors the real restorer: strands are applied ONLY when the caller asks (opts.strategy/savedSearch).
      if (opts && (opts.strategy || opts.savedSearch) && ss.filters.strategy) {
        const want = String(ss.filters.strategy).split(',');
        boxes.forEach((b) => { b.checked = want.includes(b.value); });
      }
    },
    __applyStrategyBoxes: () => { calls.applyBoxes++; return boxes.filter((b) => b.checked).map((b) => b.value); },
    __mapMatchTotals: env.totals,
    __lensFilters: () => env.lensFilters || null,
  };
  const location = { search };
  const setTimeout = (fn: () => void) => { timers.push(fn); return 0; };
  const fn = new Function('window', 'document', 'location', 'setTimeout',
    PREDICATE + '\n' + SCOPE_IIFE + '\n' + STRATEGY_IIFE);
  fn(win, document, location, setTimeout);
  // Drain the polling retries (bounded: the pill's 1s "now" ticker re-arms forever by design).
  for (let i = 0; i < 60 && timers.length; i++) timers.shift()!();
  const pill = byId.todaysLensPill as El | undefined;
  const pillText = (el?: El): string => (el ? el.textContent + el.children.map(pillText).join(' ') : '');
  return { calls, boxes, pill, pillText: pillText(pill), counts: byId.todaysLensCounts?.textContent ?? null };
}

const LENS_LINK = '?strategy=repeat_buyer%2Csb_friendly%2Csources_sought&naics=236220%2C541330&lens_n=13&lens_on=2026-10-21&src=alert';

describe('lens link WITH a scope — exactly one writer', () => {
  it('the scope restore applies naics AND strategy in ONE call; the strategy handler never writes', () => {
    const r = run(LENS_LINK);
    expect(r.calls.applySaved).toHaveLength(1);
    expect(r.calls.applySaved[0].ss.filters.naics).toBe('236220,541330');
    expect(r.calls.applySaved[0].ss.filters.strategy).toBe('repeat_buyer,sb_friendly,sources_sought');
    expect(r.calls.applySaved[0].opts).toEqual({ strategy: true });
    expect(r.calls.applyBoxes).toBe(0);
    expect(r.boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(['repeat_buyer', 'sb_friendly', 'sources_sought']);
  });

  it('the pill still names the lens (drawn from the boxes the scope restore checked)', () => {
    const r = run(LENS_LINK);
    expect(r.pill).toBeTruthy();
    expect(r.pillText).toContain('Today’s Lens: Repeat Buyer · SB-Friendly · Shapeable');
  });

  it('then vs now: the alert\'s count is labelled with its send date; the live total is labelled "now"', () => {
    const r = run(LENS_LINK, {
      totals: { settled: true, total: 12, totalKnown: true, anyFailed: false },
      lensFilters: { strategy: 'repeat_buyer,sb_friendly,sources_sought', naics: '236220,541330' },
    });
    expect(r.counts).toBe('13 recommended when your alert was sent (Oct 21) · 12 match now');
  });

  it('while the map is still counting, it says so — never a 0 or a stale number', () => {
    const r = run(LENS_LINK, {
      totals: { settled: false, total: 0, totalKnown: true },
      lensFilters: { strategy: 'repeat_buyer,sb_friendly,sources_sought', naics: '236220,541330' },
    });
    expect(r.counts).toBe('13 recommended when your alert was sent (Oct 21) · counting now…');
  });

  it('an unknown total is "unavailable", not 0', () => {
    const r = run(LENS_LINK, {
      totals: { settled: true, total: 0, totalKnown: false },
      lensFilters: { strategy: 'repeat_buyer,sb_friendly,sources_sought', naics: '236220,541330' },
    });
    expect(r.counts).toContain('current count unavailable');
    expect(r.counts).not.toContain('0 match now');
  });

  it('once the reader changes the filters, the "now" number is withdrawn (it would describe another set)', () => {
    const r = run(LENS_LINK, {
      totals: { settled: true, total: 400, totalKnown: true },
      lensFilters: { strategy: 'repeat_buyer', naics: '236220,541330' },
    });
    expect(r.counts).toBe('13 recommended when your alert was sent (Oct 21)');
  });

  it('in-app hero link (src=todays_intel) says where the count came from, with no send date', () => {
    const r = run('?strategy=repeat_buyer%2Csb_friendly&naics=541512&lens_n=7&src=todays_intel', {
      totals: { settled: true, total: 7, totalKnown: true },
      lensFilters: { strategy: 'repeat_buyer,sb_friendly', naics: '541512' },
    });
    expect(r.counts).toBe('7 recommended in Today’s Intel · 7 match now');
  });

  it('never claims the historical set: no "the alert\'s 13" / "these 13" wording', () => {
    const r = run(LENS_LINK, { totals: { settled: true, total: 12, totalKnown: true },
      lensFilters: { strategy: 'repeat_buyer,sb_friendly,sources_sought', naics: '236220,541330' } });
    expect(r.counts).not.toMatch(/these 13|the 13|alert.s 13/i);
  });
});

describe('legacy and unrelated links are unchanged', () => {
  it('strategy-only link (emails sent before this fix): the strategy handler applies, no scope restore', () => {
    const r = run('?strategy=repeat_buyer%2Csb_friendly&src=alert');
    expect(r.calls.applySaved).toHaveLength(0);
    expect(r.calls.applyBoxes).toBe(1);
    expect(r.pill).toBeTruthy();
    expect(r.counts).toBeNull();                 // no lens_n → no then/now line
  });

  it('naics-only scope link: one scope restore, no strategy, strategy handler idle', () => {
    const r = run('?naics=541512');
    expect(r.calls.applySaved).toHaveLength(1);
    expect(r.calls.applySaved[0].opts).toBeUndefined();
    expect(r.calls.applySaved[0].ss.filters.strategy).toBeUndefined();
    expect(r.calls.applyBoxes).toBe(0);
    expect(r.pill).toBeUndefined();
  });

  it('?opp= record link: neither handler writes anything', () => {
    const r = run('?opp=51ef97706881437ca7bef12a9760fca2');
    expect(r.calls.applySaved).toHaveLength(0);
    expect(r.calls.applyBoxes).toBe(0);
    expect(r.pill).toBeUndefined();
  });

  it('junk strands with a scope: the scope still applies, no fabricated lens pill', () => {
    const r = run('?strategy=not_a_strand&naics=541512&lens_n=4&src=alert');
    expect(r.calls.applySaved).toHaveLength(1);
    expect(r.calls.applyBoxes).toBe(0);
    expect(r.pill).toBeUndefined();
  });
});

describe('source guards on the real restorer', () => {
  const restorer = MAP.slice(MAP.indexOf('window.__applySavedSearch=function(ss,opts){'), MAP.indexOf('return {unsupported:_unsupported};'));
  it('opts.strategy (not only savedSearch) applies the strands', () => {
    expect(restorer).toMatch(/var _withStrategy=_asSaved\|\|!!\(opts&&opts\.strategy\);/);
    expect(restorer).toMatch(/if\(_withStrategy\)\{\s*var _strat=/);
  });
  it('opts.strategy does NOT turn on the saved-search-only behaviours (horizons default, national view)', () => {
    expect(restorer).toMatch(/if\(!_hz&&_asSaved&&wantMode==='open'\)/);
    expect(restorer).toMatch(/else if\(_asSaved&&typeof window\.__mapNationalView==='function'\)/);
  });
  it('the scope handler passes the strands through that one restore', () => {
    expect(MAP).toContain("if(strategy){ f.strategy=strategy; window.__applySavedSearch({ mode:_mode, filters:f },{ strategy:true }); }");
  });
});
