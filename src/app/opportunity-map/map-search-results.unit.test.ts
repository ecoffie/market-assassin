/**
 * map_search carries a result count, and the natural-language path emits it too (activation, 2026-11-14).
 *
 * Before: map_search fired at submit time with no count, and a search resolved by
 * __applySearchFilters (e.g. "Army opportunities in Florida") emitted nothing, so "first meaningful
 * search" (a submitted search with results > 0) could not be measured.
 *
 * These tests run the REAL search-panel code (sliced from route.ts) against a fake window and the
 * round-state contract the viewport script publishes (window.__searchRoundState).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

function searchBlock(): string {
  const start = MAP.indexOf("var _lastCap='', _pend=null, _pendT=0;");
  const end = MAP.indexOf('function captureSearch(q){');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return MAP.slice(start, end);
}

type Win = { __track: ReturnType<typeof vi.fn>; __searchRoundState: { gen: number; settledGen: number; results: number | null; pendingDispatch: boolean } };
function load() {
  const win: Win = { __track: vi.fn(), __searchRoundState: { gen: 1, settledGen: 1, results: 5, pendingDispatch: false } };
  const beginSearch = new Function('window', `${searchBlock()}; return beginSearch;`)(win) as (q: string, via: string) => boolean;
  return { win, beginSearch };
}

describe('map_search emitter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits once with the settled round count, keyword path keeps query text', () => {
    const { win, beginSearch } = load();
    expect(beginSearch('roofing', 'keyword')).toBe(true);
    win.__searchRoundState.pendingDispatch = true; // the Enter commit queued a round
    vi.advanceTimersByTime(300);
    expect(win.__track).not.toHaveBeenCalled();
    Object.assign(win.__searchRoundState, { gen: 2, pendingDispatch: false }); // dispatched, not settled
    vi.advanceTimersByTime(500);
    expect(win.__track).not.toHaveBeenCalled();
    Object.assign(win.__searchRoundState, { settledGen: 2, results: 42 });
    vi.advanceTimersByTime(250);
    expect(win.__track).toHaveBeenCalledTimes(1);
    expect(win.__track).toHaveBeenCalledWith('tool_use', 'map_search', { query_len: 7, via: 'keyword', results: 42, query: 'roofing' });
  });

  it('intent path emits with no query text', () => {
    const { win, beginSearch } = load();
    beginSearch('Army opportunities in Florida', 'intent');
    Object.assign(win.__searchRoundState, { gen: 2, settledGen: 2, results: 0 });
    vi.advanceTimersByTime(300);
    const meta = win.__track.mock.calls[0][2];
    expect(meta).toEqual({ query_len: 29, via: 'intent', results: 0 });
    expect(meta.query).toBeUndefined();
  });

  it('an unknown total is null, never 0; no settled round within 20 s is null', () => {
    const { win, beginSearch } = load();
    Object.assign(win.__searchRoundState, { gen: 2, settledGen: 2, results: null });
    beginSearch('janitorial', 'keyword');
    vi.advanceTimersByTime(300);
    expect(win.__track.mock.calls[0][2].results).toBeNull();

    const b = load();
    b.beginSearch('hvac', 'keyword');
    b.win.__searchRoundState.pendingDispatch = true; // held round never dispatches
    vi.advanceTimersByTime(20_500);
    expect(b.win.__track).toHaveBeenCalledTimes(1);
    expect(b.win.__track.mock.calls[0][2].results).toBeNull();
  });

  it('dedup preserved: the same text twice is one search; a newer submit closes the older as unknown', () => {
    const { win, beginSearch } = load();
    expect(beginSearch('Roofing', 'keyword')).toBe(true);
    expect(beginSearch('roofing ', 'keyword')).toBe(false);
    win.__searchRoundState.pendingDispatch = true;
    expect(beginSearch('fencing', 'keyword')).toBe(true);
    expect(win.__track).toHaveBeenCalledTimes(1);
    expect(win.__track.mock.calls[0][2]).toMatchObject({ query: 'Roofing', results: null });
  });

  it('the viewport script publishes round state at every round start and settle', () => {
    expect(MAP).toContain('window.__searchRoundState=_sr;');
    expect(MAP).toContain('round.srGen=_srStart();');
    expect(MAP).toContain("_srSettle(round.srGen, (window.__mapMatchTotals&&window.__mapMatchTotals.totalKnown)?TOTAL:null);");
    expect(MAP).toContain('var _csr=_srStart();');
    expect(MAP).toMatch(/beginSearch\(q,'intent'\)/);
  });
});
