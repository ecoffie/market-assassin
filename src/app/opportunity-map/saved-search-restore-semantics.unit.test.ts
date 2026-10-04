/**
 * What "restore a SAVED SEARCH" means — executed, not grepped.
 *
 * The reported row (2026-10-04) is { mode:'open', filters:{ naics:'336611,336612',
 * agency:'DEFENSE', status:'active' }, bbox:null } — created without a horizons key or bounds.
 * Restoring it with the restorer's generic behaviour would still not show "your filters exactly
 * as you saved them":
 *   · horizons untouched → the map's default (all three ON) mixes Awarded + Forecast rows into a
 *     search whose alerts are Open-only (wantsForecasts() in cron/saved-search-alerts);
 *   · viewport untouched → this browser's remembered view frames one region of a nationwide
 *     search (measured on prod: 23 pins in the remembered east-coast view vs 49 across CONUS).
 *
 * Those semantics are OPT-IN (opts.savedSearch). Scope links and return continuity call the same
 * restorer with no bbox / horizons ON PURPOSE (they keep the viewport and the horizon chips), and
 * the last describe block pins that they are unchanged.
 *
 * RED → GREEN: MAPS_ROUTE_SRC=<(git show 657801d8:src/app/opportunity-map/route.ts) fails the
 * saved-search cases.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');
const unT = (s: string) => s.replace(/\\\\/g, '\\');
const RESTORER = unT(SRC.slice(SRC.indexOf('  window.__applySavedSearch=function'), SRC.indexOf('  // Clear all: reset the server filters')));

const STRANDS = ['repeat_buyer', 'sb_friendly', 'posts_early', 'sources_sought', 'closes_soon', 'set_aside'];

function restore(ss: unknown, opts?: unknown, start: { horizons?: Record<string, boolean>; mode?: string } = {}) {
  const calls: unknown[] = [];
  const boxes = STRANDS.map((value) => ({ value, checked: false }));
  const horizons = { open: true, recompete: true, forecast: true, ...(start.horizons || {}) };
  const win: Record<string, unknown> = {
    __horizons: horizons,
    toggleHorizon: (h: keyof typeof horizons) => {
      const on = Object.values(horizons).filter(Boolean).length;
      if (horizons[h] && on <= 1) return;   // the real "never turn the last one off" guard
      horizons[h] = !horizons[h];
    },
    __selectShow: () => {},
    __mapNationalView: () => { calls.push('national'); },
    __INDUSTRY_PRESETS: [],
    __STATE_NAMES: {},
  };
  const document = {
    querySelectorAll: (sel: string) => (sel === '.mf-strategy' ? boxes : []),
    getElementById: () => null,
  };
  const ctx = vm.createContext({
    window: win, document, localStorage: { getItem: () => null },
    calls, MODE: start.mode || 'open', FILT: {}, Q: '', _didAutoFit: false,
    map: { fitBounds: (b: unknown) => calls.push(['fit', b]) },
  });
  vm.runInContext(`
    function setMapMode(m){ MODE=m; calls.push('mode:'+m); }
    function fetchView(){ calls.push('fetch'); }
    ${RESTORER}
    var __out = window.__applySavedSearch(__ss, __opts);
  `.replace('__ss', JSON.stringify(ss)).replace('__opts', opts === undefined ? 'undefined' : JSON.stringify(opts)), ctx);
  return {
    out: (ctx as { __out?: { unsupported?: string[] } }).__out,
    FILT: (ctx as { FILT: Record<string, unknown> }).FILT,
    horizons, calls, boxes,
  };
}

const REPORTED = {
  id: '6e376442-819e-420f-b149-ef62861814ca',
  name: 'Atlantic Craft Partners JV — Navy Shipbuilding & Small Craft',
  mode: 'open',
  filters: { naics: '336611,336612', agency: 'DEFENSE', status: 'active' },
  bbox: null,
};

describe('the reported saved search, restored as a saved search', () => {
  const r = restore(REPORTED, { savedSearch: true });

  it('applies the stored NAICS + agency into the filters the Map API is built from', () => {
    expect(r.FILT.naics).toBe('336611,336612');
    expect(r.FILT.agency).toBe('DEFENSE');
    expect(r.calls).toContain('fetch');
  });

  it('shows the Open horizon only — what the alert cron searches for this row', () => {
    expect(r.horizons).toEqual({ open: true, recompete: false, forecast: false });
  });

  it('no bounds → the national frame, not the remembered viewport', () => {
    expect(r.calls).toContain('national');
    expect(r.calls.indexOf('national')).toBeLessThan(r.calls.indexOf('fetch'));   // frame first, then one round
  });

  it('status:active is represented (the open map always sends it); nothing reported unsupported', () => {
    expect(r.out?.unsupported).toEqual([]);
  });
});

describe('saved-search semantics, case by case', () => {
  it('a saved bbox wins over the national frame', () => {
    const r = restore({ ...REPORTED, bbox: { w: -82, s: 27, e: -80, n: 29 } }, { savedSearch: true });
    expect(r.calls).toContainEqual(['fit', [[27, -82], [29, -80]]]);
    expect(r.calls).not.toContain('national');
  });

  it('a saved horizons object is honoured exactly (forecast-only stays forecast-only)', () => {
    const r = restore({ ...REPORTED, filters: { ...REPORTED.filters, horizons: { open: false, recompete: false, forecast: true } } }, { savedSearch: true });
    expect(r.horizons).toEqual({ open: false, recompete: false, forecast: true });
  });

  it('strategy strands restore into FILT.strategy (an ARRAY) and the checkboxes; unknown strands are dropped', () => {
    const r = restore({ ...REPORTED, filters: { ...REPORTED.filters, strategy: 'repeat_buyer,closes_soon,made_up' } }, { savedSearch: true });
    expect(r.FILT.strategy).toEqual(['repeat_buyer', 'closes_soon']);
    expect(r.boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(['repeat_buyer', 'closes_soon']);
  });

  it('a key the map cannot show is REPORTED, never silently dropped', () => {
    const r = restore({ ...REPORTED, filters: { ...REPORTED.filters, status: 'inactive', hideCommodity: '1' } }, { savedSearch: true });
    expect(r.out?.unsupported).toEqual(['status', 'hideCommodity']);
  });
});

describe('scope links and return continuity are unchanged (no opts)', () => {
  it('keep the viewport and the horizon chips', () => {
    const r = restore({ mode: 'open', filters: { naics: '336611' } });
    expect(r.calls).not.toContain('national');
    expect(r.horizons).toEqual({ open: true, recompete: true, forecast: true });
    expect(r.FILT.naics).toBe('336611');
  });
});
