/**
 * Forecast publisher coverage — "unavailable is not zero" (Eric, 2026-09-23).
 *
 * The canonical plan decides coverage per requested buyer; MCP and Maps read the SAME result.
 *   covered                      → a 0 is a measured zero
 *   publisher_without_forecasts  → a KNOWN identity we hold nothing for (FAA)
 *   unresolved_publisher         → no forecast publisher identity at all (NOAA, COMMERCE, HUD, SBA)
 * Hermetic: plans are pure; the live-DB half of the proof is the replay in
 * tasks/discovery-forecast-coverage-2026-09-23.md.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPlan, MCP_POLICY, MAPS_POLICY, SAVED_SEARCH_POLICY, type PlanContext } from './index';
import { mapsForecastRequest, mapsForecastDiscoveryMeta, forecastCoverageUnavailable } from '@/lib/opportunities/maps-forecast-discovery';
import { headlineFor, type HorizonResult } from '@/lib/opportunities/find-opportunities';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
const fc = (agency: string | string[], query = '', policy = MCP_POLICY) =>
  buildDiscoveryPlan({ query, agency }, policy, CTX).horizons.forecast;
const failsClosed = (ops: Array<{ op: string; col?: string; val?: unknown }>) =>
  ops.length === 1 && ops[0].op === 'is' && ops[0].col === 'id' && ops[0].val === null;

describe('unresolved publisher → UNAVAILABLE, never a measured zero', () => {
  it.each(['National Oceanic and Atmospheric Administration', 'NOAA', 'COMMERCE', 'HUD', 'SBA'])('%s', (a) => {
    const f = fc(a);
    expect(f.coverage).toBe('unestablished');
    expect(f.coverageGaps).toEqual([{ requested: a, reason: 'unresolved_publisher' }]);
    // No records can be produced: the query fails closed, and no agency text fallback is left to fabricate a 0.
    expect(failsClosed(f.ops)).toBe(true);
    expect(f.forecastFilters.agency).toBeNull();
    expect(f.via).toBe('coverage_unestablished');
  });
  it('holds for every surface policy (MCP, Maps, Saved Search)', () => {
    for (const p of [MCP_POLICY, MAPS_POLICY, SAVED_SEARCH_POLICY]) expect(fc('NOAA', 'weather', p).coverage).toBe('unestablished');
  });
});

describe('known publisher with no forecasts stays a DISTINCT state', () => {
  it('FAA → publisher_without_forecasts, carrying the parent that does publish', () => {
    const f = fc('FAA');
    expect(f.coverage).toBe('unestablished');
    expect(f.coverageGaps?.[0]).toMatchObject({ requested: 'FAA', reason: 'publisher_without_forecasts', label: 'Federal Aviation Administration', parentWithData: 'DOT' });
  });
});

describe('covered publisher → coverage ok, so a 0 is a MEASURED zero', () => {
  it('VA (publisher with results) — ok, filter kept, no gaps', () => {
    const f = fc('VA', 'janitorial');
    expect(f.coverage).toBe('ok');
    expect(f.coverageGaps).toBeUndefined();
    expect(f.forecastFilters.agency).toBe('VA');
    expect(failsClosed(f.ops)).toBe(false);
  });
  it('EPA + a query with no forecasts — still ok: the zero is measured, not unavailable', () => {
    const f = fc('EPA', 'zzzxxyyqqq');
    expect(f.coverage).toBe('ok');
    expect(failsClosed(f.ops)).toBe(false);
  });
  it('no buyer asked → ok (coverage is about requested buyers only)', () => {
    expect(buildDiscoveryPlan({ query: 'janitorial' }, MCP_POLICY, CTX).horizons.forecast.coverage).toBe('ok');
  });
  it('an unresolved FRAGMENT inside a covered buyer is not a missing publisher ("STATE, DEPARTMENT")', () => {
    const f = fc('STATE, DEPARTMENT');
    expect(f.coverage).toBe('ok');
    expect(f.forecastFilters.agency).toBe('STATE, DEPARTMENT');
  });
});

describe('multi-agency OR', () => {
  it('all covered → ok, the OR filter unchanged', () => {
    const f = fc(['VA', 'DOJ']);
    expect(f.coverage).toBe('ok');
    expect(f.forecastFilters.agency).toBe('VA|DOJ');
  });
  it('some covered → partial: counts cover ONLY the covered buyers; the missing ones are named', () => {
    const f = fc(['VA', 'NOAA', 'DOJ', 'FAA']);
    expect(f.coverage).toBe('partial');
    expect(f.forecastFilters.agency).toBe('VA|DOJ');
    expect(f.coverageGaps).toEqual([
      { requested: 'NOAA', reason: 'unresolved_publisher' },
      expect.objectContaining({ requested: 'FAA', reason: 'publisher_without_forecasts' }),
    ]);
    expect(failsClosed(f.ops)).toBe(false);
  });
  it('none covered → unestablished, fails closed', () => {
    const f = fc(['NOAA', 'HUD', 'SBA', 'COMMERCE']);
    expect(f.coverage).toBe('unestablished');
    expect(f.coverageGaps?.map((g) => g.requested)).toEqual(['NOAA', 'HUD', 'SBA', 'COMMERCE']);
    expect(failsClosed(f.ops)).toBe(true);
  });
});

describe('MCP and Maps consume the SAME coverage result', () => {
  it.each([['NOAA'], ['VA|NOAA'], ['VA|DOJ'], ['FAA'], ['HUD|SBA']])('agency=%s', (agency) => {
    const maps = mapsForecastRequest((k) => (k === 'agency' ? agency : k === 'q' ? 'janitorial' : null), { ctx: CTX });
    const list = agency.split('|');
    const mcp = buildDiscoveryPlan({ query: 'janitorial', agency: list.length > 1 ? list : list[0] }, MCP_POLICY, CTX).horizons.forecast;
    const m = maps.plan.horizons.forecast;
    expect(m.coverage).toBe(mcp.coverage);
    expect(m.coverageGaps).toEqual(mcp.coverageGaps);
    expect(m.ops).toEqual(mcp.ops);
    expect(m.forecastFilters).toEqual(mcp.forecastFilters);
    const meta = mapsForecastDiscoveryMeta(maps.plan);
    expect(meta.coverage).toBe(mcp.coverage);
    expect((meta as { coverage_gaps?: unknown }).coverage_gaps).toEqual(mcp.coverageGaps);
    expect(forecastCoverageUnavailable(maps.plan)).toBe(mcp.coverage === 'unestablished');
  });
});

describe('MCP headline never turns missing coverage into a zero', () => {
  const hz = (status: HorizonResult['status'], n: number | null, extra: Partial<HorizonResult> = {}): HorizonResult => ({
    status, matched_count: n, returned_count: 0, items: [], source: 'x', as_of: null, filters_consumed: [], filters_unsupported: [],
    unmapped_count: null, error: null, allowed_handoffs: [], semantics_note: null, ...extra,
  });
  it('partial names the missing buyers next to the covered count', () => {
    const h = headlineFor({
      open_now: hz('empty', 0), coming_back: hz('empty', 0),
      coming_soon: hz('partial', 12, { coverage: { state: 'partial', gaps: [{ requested: 'NOAA', reason: 'unresolved_publisher' }] } }),
    });
    expect(h).toMatch(/12 coming soon \(partial — not measured: NOAA\)/);
  });
  it('a covered partial horizon with 0 measured rows keeps the 0 and still names the gap', () => {
    const h = headlineFor({
      open_now: hz('empty', 0), coming_back: hz('empty', 0),
      coming_soon: hz('partial', 0, { coverage: { state: 'partial', gaps: [{ requested: 'HUD', reason: 'unresolved_publisher' }] } }),
    });
    expect(h).toMatch(/0 coming soon \(partial — not measured: HUD\)/);
  });
});
