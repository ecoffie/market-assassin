/**
 * "No matches in this map view" vs "no matches at all" — and framing a saved search on its matches.
 *
 * Measured 2026-10-04 on a phone (390 px): a saved search with no bounds (Navy shipbuilding,
 * NAICS 336611/336612, 56 located + 8 unlocated) opened at the fixed CONUS start, zoom 5 — on a
 * phone a strip of the central US (lng −104.6…−87.5) holding NONE of the shipyards. The list read
 * "56 results" over "No opportunities match / Clear all filters": advice that would delete a search
 * that HAS matches. Zooming out cannot fix it — below PIN_DOT_ZOOM (5) the map draws no pins.
 *
 * These tests EXECUTE the real code:
 *   · drawFeed's empty branches (template.html) against the totals each round publishes;
 *   · __showMatchingLocations + _frameFor (route.ts) against a Leaflet stand-in with a REAL
 *     web-Mercator projection, on phone- and desktop-sized maps, with the live 56 coordinates.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROUTE = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const TMPL = readFileSync(join(__dirname, 'template.html'), 'utf8');
const unT = (s: string) => s.replace(/\\\\/g, '\\');

// ── 1. The list's empty states ────────────────────────────────────────────────────────────────
function emptyFeed(totals: unknown, opts: { helper?: boolean } = {}) {
  const start = TMPL.indexOf('function drawFeed(){');
  const end = TMPL.indexOf("  feed.innerHTML='';", start);
  const body = TMPL.slice(start, end) + '}';
  const feed = { innerHTML: '' };
  const ctx: Record<string, unknown> = {
    rows: [], window: { __mapMatchTotals: totals, ...(opts.helper === false ? {} : { __showMatchingLocations() {} }) },
    document: { getElementById: (id: string) => (id === 'feed' ? feed : null) },
    esc: (s: string) => s,
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\ndrawFeed();', ctx);
  return feed.innerHTML.replace(/\s+/g, ' ');
}

describe('the list distinguishes "none in this view" from "none at all"', () => {
  it('matches elsewhere → "No matches in this map view" + Show matching locations, never "clear filters"', () => {
    const h = emptyFeed({ total: 56, inView: 0, unmapped: 8, capped: false, settled: true, anyFailed: false });
    expect(h).toContain('No matches in this map view');
    expect(h).toContain('56 opportunities match your filters in other locations (plus 8 without a map location)');
    expect(h).toContain('Show matching locations');
    expect(h).not.toMatch(/Clear all filters|No opportunities match/);
  });

  it('a capped total is a floor ("1,000+"), never a hard number', () => {
    expect(emptyFeed({ total: 1000, inView: 0, unmapped: 0, capped: true, settled: true, anyFailed: false })).toContain('1,000+ opportunities match');
  });

  it('matches exist but NONE has a location → say so; no button that cannot work, no "clear filters"', () => {
    const h = emptyFeed({ total: 0, inView: 0, unmapped: 3, capped: false, settled: true, anyFailed: false });
    expect(h).toContain('No matches can be placed on the map');
    expect(h).toContain('3 opportunities match your filters, but none has a map location');
    expect(h).not.toMatch(/Show matching locations|Clear all filters/);
  });

  it('genuinely zero → the original state, which is the only one that suggests clearing filters', () => {
    const h = emptyFeed({ total: 0, inView: 0, unmapped: 0, capped: false, settled: true, anyFailed: false });
    expect(h).toContain('No opportunities match');
    expect(h).toContain('Clear all filters');
  });

  it('an UNKNOWN unmapped count (null) is never read as "no matches can be placed"', () => {
    const h = emptyFeed({ total: 0, inView: 0, unmapped: null, capped: false, settled: true, anyFailed: false });
    expect(h).not.toContain('No matches can be placed');
  });
});

// ── 2. Framing on the matches ─────────────────────────────────────────────────────────────────
// A Leaflet stand-in with the real EPSG:3857 projection (256 px tiles), so window maths is honest.
function leaflet(size: { x: number; y: number }, view: { lat: number; lng: number; z: number }) {
  const project = (ll: { lat: number; lng: number }, z: number) => {
    const s = 256 * 2 ** z; const r = Math.PI / 180;
    return { x: ((ll.lng + 180) / 360) * s, y: (0.5 - Math.log(Math.tan(Math.PI / 4 + (ll.lat * r) / 2)) / (2 * Math.PI)) * s };
  };
  const unproject = (p: { x: number; y: number }, z: number) => {
    const s = 256 * 2 ** z;
    return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * p.y) / s))) * 180) / Math.PI, lng: (p.x / s) * 360 - 180 };
  };
  const bounds = (pts: Array<[number, number]>) => {
    const b = { s: 90, n: -90, w: 180, e: -180 };
    pts.forEach(([la, ln]) => { b.s = Math.min(b.s, la); b.n = Math.max(b.n, la); b.w = Math.min(b.w, ln); b.e = Math.max(b.e, ln); });
    return { ...b, pad: () => b, toArr: () => b };
  };
  const moves: unknown[] = [];
  const map = {
    getSize: () => size, getCenter: () => ({ lat: view.lat, lng: view.lng }), getZoom: () => view.z,
    project: (ll: { lat: number; lng: number }, z: number) => project(ll, z), unproject: (p: { x: number; y: number }, z: number) => unproject(p, z),
    getBoundsZoom: (b: { s: number; n: number; w: number; e: number }, _inside: boolean, pad: { x: number; y: number }) => {
      for (let z = 18; z >= 0; z--) {
        const a = project({ lat: b.n, lng: b.w }, z), c = project({ lat: b.s, lng: b.e }, z);
        if (c.x - a.x <= size.x - pad.x && c.y - a.y <= size.y - pad.y) return z;
      }
      return 0;
    },
    fitBounds: (b: unknown) => { moves.push(['fit', b]); view.z = 7; },
    setView: (c: { lat: number; lng: number }, z: number) => { moves.push(['view', { lat: +c.lat.toFixed(2), lng: +c.lng.toFixed(2) }, z]); view.lat = c.lat; view.lng = c.lng; view.z = z; },
    setZoom: (z: number) => { view.z = z; },
  };
  const L = { latLngBounds: bounds, latLng: (lat: number, lng: number) => ({ lat, lng }), point: (x: number, y: number) => ({ x, y }) };
  return { map, L, moves, view, project };
}
function extract(src: string, start: string, end: string) {
  const a = src.indexOf(start); const b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('marker missing: ' + start);
  return unT(src.slice(a, b));
}
const HELPER = extract(ROUTE, "  var WORLD_BOX='-180.0000,-85.0000,180.0000,85.0000';", '\n  // Search auto-jump');
const BUILDER = extract(ROUTE, "  function _merge(a,b){", '  function _fetchViewNow(t0){');

// The located matches for the reported search, exactly as the live API returned them (world bbox,
// agency=DEFENSE, naics=336611,336612; fetched 2026-10-04) — coordinates only, 56 pins.
const NAVY: Array<[number, number]> = [
  [40.002, -82.9784], [39.969, -83.0114], [39.903, -83.0774], [40.024, -83.0004], [37.4121, -77.4065], [39.936, -83.0444],
  [39.936, -83.0444], [39.903, -83.0774], [39.936, -83.0444], [40.002, -82.9784], [35.2836, 139.6672], [28.038, -82.3859],
  [38.9499, -86.8892], [36.8529, -76.4111], [21.3511, -157.9719], [39.914, -83.0224], [38.9714, -76.9837], [21.3841, -157.9389],
  [1.3007, 103.734], [36, 138], [38.9714, -76.9837], [39.925, -82.9674], [39.9936, -75.1478], [39.969, -83.0114],
  [39.947, -82.9894], [39.947, -82.9894], [39.958, -83.0664], [39.958, -83.0664], [45.515, -122.628], [38.9714, -76.9837],
  [40.2012, -77.0815], [39.8233, -75.2442], [40.013, -83.0554], [33.1903, 129.703], [1.3337, 103.767], [38.9714, -76.9837],
  [40.2672, -77.0155], [40.2672, -77.0155], [36.9796, -76.3474], [47.5373, -122.6272], [36.8806, -76.3144], [39.9003, -75.1232],
  [40.1462, -77.0925], [47.6143, -122.6382], [47.5153, -122.6052], [30.2935, -81.7246], [32.7965, -117.1698], [38.8834, -77.0277],
  [38.8944, -76.9727], [41.543, -71.343], [39.8453, -75.1342], [40.2232, -76.9715], [38.8724, -76.9507], [39.0336, -77.1978],
  [38.9714, -76.9837], [39.9513, -75.1741],
];

function run(opts: { size: { x: number; y: number }; pins: Array<[number, number]> | null; moveDuring?: boolean; changeDuring?: boolean; unlessMoved?: boolean }) {
  const lf = leaflet(opts.size, { lat: 38, lng: -96, z: 5 });
  const urls: string[] = [];
  let sig = 'S0'; let result: unknown = null;
  const ctx: Record<string, unknown> = {
    map: lf.map, L: lf.L, PIN_DOT_ZOOM: 5, MODE: 'open', _didAutoFit: false, Math, JSON, isFinite, Promise,
    isContactMode: () => false,
    FILT: { naics: '336611,336612', agency: 'DEFENSE', setAside: '', setAsideMulti: '', fullOpen: false, scope: 'all', noticeType: '', noticeMulti: '', state: '', closingDays: '', psc: '', postedDays: '', subAgency: '', country: '', hasDocs: '', hasContact: '', sapBuyer: '' },
    MODES: { open: { ep: '/api/app/opportunity-map' }, recompete: { ep: '/api/app/recompete-map' }, forecast: { ep: '/api/app/forecast-map' } },
    HIDE_FSC: false, Q: '', _uemail: () => '', encodeURIComponent,
    bbox: () => '-104.5898,24.2870,-87.4512,49.5537',
    window: { __horizons: { open: true, recompete: false, forecast: false }, __mapMode: 'open', __mapIntentSig: () => sig },
    fetch: (u: string) => {
      urls.push(u);
      if (opts.moveDuring) lf.view.lng += 3;          // the reader pans while we ask
      if (opts.changeDuring) sig = 'S1';              // ...or changes a filter
      return Promise.resolve({ ok: opts.pins !== null, json: async () => ({ success: true, pins: (opts.pins || []).map(([lat, lng]) => ({ lat, lng })) }) });
    },
  };
  (ctx.window as Record<string, unknown>).window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(`${BUILDER}\n${HELPER}\nthis.__go=window.__showMatchingLocations;`, ctx);
  const go = ctx.__go as (o: unknown) => void;
  const done = new Promise((r) => go({ unlessMoved: opts.unlessMoved, done: (x: unknown) => { result = x; r(x); } }));
  return { done, urls, moves: lf.moves, view: lf.view, project: lf.project, size: opts.size, result: () => result as Record<string, unknown> };
}
const PHONE = { x: 390, y: 600 };
const DESKTOP = { x: 1286, y: 760 };
const inView = (h: ReturnType<typeof run>, pts: Array<[number, number]>) => {
  const c = h.project({ lat: h.view.lat, lng: h.view.lng }, h.view.z);
  return pts.filter(([lat, lng]) => { const p = h.project({ lat, lng }, h.view.z); return Math.abs(p.x - c.x) <= h.size.x / 2 && Math.abs(p.y - c.y) <= h.size.y / 2; }).length;
};

describe('Show matching locations — moves the viewport, keeps every filter', () => {
  it('asks with the SAME filters as a round, only the box changes to the whole world', async () => {
    const h = run({ size: PHONE, pins: NAVY });
    await h.done;
    expect(h.urls).toEqual(['/api/app/opportunity-map?bbox=-180.0000,-85.0000,180.0000,85.0000&status=active&sources=sam,sbir&agency=DEFENSE&naics=336611%2C336612']);
  });

  it('phone: lands on the window with the most matches (the reported strip held 0 of 56)', async () => {
    const h = run({ size: PHONE, pins: NAVY });
    await h.done;
    expect(h.result().ok).toBe(true);
    expect(h.view.z).toBe(5);                                  // never below the pin floor
    expect(inView(h, NAVY)).toBeGreaterThanOrEqual(20);        // the Columbus cluster at least
    const before = NAVY.filter(([la, ln]) => la >= 24.287 && la <= 49.554 && ln >= -104.59 && ln <= -87.45).length;
    expect(before).toBeLessThan(inView(h, NAVY));
  });

  it('desktop: more matches in the frame than the fixed CONUS start', async () => {
    const h = run({ size: DESKTOP, pins: NAVY });
    await h.done;
    const conusStart = NAVY.filter(([la, ln]) => la >= 23.24 && la <= 50.32 && ln >= -116.59 && ln <= -75.45).length;
    expect(inView(h, NAVY)).toBeGreaterThanOrEqual(conusStart);
  });

  it('overseas majority → the frame goes overseas (a federal market is not US-only)', async () => {
    const japan: Array<[number, number]> = [...Array.from({ length: 9 }, (_, i) => [35.28 + i * 0.01, 139.67] as [number, number]), [38.9, -77.0]];
    const h = run({ size: PHONE, pins: japan });
    await h.done;
    expect(h.view.lng).toBeGreaterThan(100);
    expect(inView(h, japan)).toBe(9);
  });

  it('everything fits at the pin floor → fit them all', async () => {
    const h = run({ size: DESKTOP, pins: [[39.98, -82.98], [36.85, -76.29], [39.95, -75.17]] });
    await h.done;
    expect(h.moves[0]).toEqual(expect.arrayContaining(['fit']));
    expect(h.result()).toMatchObject({ ok: true, all: true, located: 3 });
  });

  it('no located match → no move, and says why (none_located), never a silent nothing', async () => {
    const h = run({ size: PHONE, pins: [] });
    await h.done;
    expect(h.moves).toEqual([]);
    expect(h.result()).toMatchObject({ ok: false, reason: 'none_located' });
  });

  it('a failed lookup → no move, reason failed', async () => {
    const h = run({ size: PHONE, pins: null });
    await h.done;
    expect(h.moves).toEqual([]);
    expect(h.result()).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('the automatic frame (saved search, no bounds) never overrides the reader', () => {
  it('a manual pan during the lookup wins', async () => {
    const h = run({ size: PHONE, pins: NAVY, unlessMoved: true, moveDuring: true });
    await h.done;
    expect(h.moves).toEqual([]);
    expect(h.result()).toMatchObject({ ok: false, reason: 'user_moved' });
  });

  it('a filter change during the lookup wins', async () => {
    const h = run({ size: PHONE, pins: NAVY, unlessMoved: true, changeDuring: true });
    await h.done;
    expect(h.moves).toEqual([]);
    expect(h.result()).toMatchObject({ ok: false, reason: 'intent_changed' });
  });

  it('it runs once: no listener is left behind to re-frame on later pans', () => {
    // The helper is called once by the restorer and only by an explicit click afterwards.
    const calls = ROUTE.match(/window\.__showMatchingLocations\(/g) || [];
    expect(calls.length).toBe(1);                       // the restorer; the button calls it from template.html
    expect(TMPL.match(/window\.__showMatchingLocations\(/g) || []).toHaveLength(1);
  });
});
