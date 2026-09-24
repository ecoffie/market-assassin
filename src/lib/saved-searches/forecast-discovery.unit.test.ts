/**
 * Saved Search Forecast → Canonical Discovery adapter.
 *
 * The adapter must add NO semantics: every plan it builds must equal the plan the canonical builder
 * produces for the same request, and the coverage outcome must come from that plan, never a count.
 * Hermetic; the live half is scripts/saved-search-forecast-migration-replay.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPlan, SAVED_SEARCH_POLICY, MAPS_POLICY, type PlanContext } from '@/lib/discovery';
import { mapsForecastRequest } from '@/lib/opportunities/maps-forecast-discovery';
import {
  savedSearchForecastRequest, fetchSavedSearchForecasts, forecastOutcomeFromPlan, forecastCoverageNotice,
  savedSearchHasSurfaceScope, resolveForecastEngine, SAVED_SEARCH_FORECAST_KEYS, SAVED_SEARCH_FORECAST_WINDOW,
} from './forecast-discovery';
import { A5F952C7_FILTERS, A5F952C7_COVERED } from './__fixtures__/a5f952c7';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
const failsClosed = (ops: Array<{ op: string; col?: string; val?: unknown }>) =>
  ops.length === 1 && ops[0].op === 'is' && ops[0].col === 'id' && ops[0].val === null;
const fyOp = (ops: Array<{ op: string; expr?: string }>) => ops.find((o) => o.op === 'or' && String(o.expr).startsWith('fiscal_year.is.null,'));

/** Recording fake of the PostgREST builder: captures every call, returns a configured result. */
function fakeDb(result: { data?: unknown; error?: { message: string } | null; throws?: boolean }) {
  const calls: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'limit', 'or', 'eq', 'is', 'in', 'ilike', 'gte', 'lte', 'not']) {
    q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
  }
  q.order = (...a: unknown[]) => {
    calls.push(['order', a]);
    if (result.throws) throw new Error('network down');
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  return { db: { from: (t: string) => { calls.push(['from', [t]]); return q; } }, calls };
}

describe('the adapter reuses the canonical Forecast builder — no forked semantics', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['typed query', { q: 'janitorial', horizons: { forecast: true } }],
    ['no query', { naics: '541512', horizons: { forecast: true } }],
    ['single agency', { agency: 'VETERANS AFFAIRS', horizons: { forecast: true } }],
    ['multi-agency OR', { agency: 'VETERANS AFFAIRS|INTERIOR|COMMERCE', horizons: { forecast: true } }],
    ['state + naics', { naics: '236220', state: 'FL,GA', horizons: { forecast: true } }],
  ];
  it.each(cases)('%s → plan identical to the Maps Forecast request for the same keys', (_n, filters) => {
    const saved = savedSearchForecastRequest(filters, CTX).plan;
    const maps = mapsForecastRequest((k) => (filters[k] == null ? null : String(filters[k])), { ctx: CTX }).plan;
    // The shared interpretation and the whole Forecast horizon are identical. Only the surface policy
    // differs, and only on OPEN (Saved Search adds its posted-30-day window) — never on Forecast.
    const shared = (p: typeof saved) => ({ ...p, policy: null, horizons: { ...p.horizons, open: null } });
    expect(shared(saved)).toEqual(shared(maps));
    expect(saved.horizons.forecast).toEqual(maps.horizons.forecast);
    expect(saved.policy).toBe(SAVED_SEARCH_POLICY);
    expect(saved.policy.forecast).toEqual(MAPS_POLICY.forecast);
  });

  it('reads only the keys the map sends to its Forecast horizon (a saved PSC never crosswalks)', () => {
    expect([...SAVED_SEARCH_FORECAST_KEYS]).toEqual(['q', 'agency', 'naics', 'state']);
    const withPsc = savedSearchForecastRequest({ psc: 'R408', setAsideMulti: 'SBA', horizons: { forecast: true } }, CTX).plan;
    expect(withPsc.psc).toEqual([]);
    expect(withPsc.horizons.forecast.forecastFilters.naics).toBeNull();
  });

  it('multi-agency is a list of DISTINCT buyers, ORed (never one combined buyer)', () => {
    const p = savedSearchForecastRequest({ agency: 'VETERANS AFFAIRS|INTERIOR' }, CTX).plan;
    expect(p.buyers.map((b) => b.requested)).toEqual(['VETERANS AFFAIRS', 'INTERIOR']);
    expect(p.horizons.forecast.forecastFilters.agency).toBe('VETERANS AFFAIRS|INTERIOR');
    expect(p.horizons.forecast.coverage).toBe('ok');
  });

  it('saved filters that already scope a market anchor an exclusion-only query', () => {
    expect(savedSearchHasSurfaceScope({ naics: '541511' })).toBe(true);
    expect(savedSearchHasSurfaceScope({ scope: 'profile' })).toBe(true);
    expect(savedSearchHasSurfaceScope({ horizons: { forecast: true } })).toBe(false);
    expect(savedSearchForecastRequest({ q: '-computers', naics: '541511,541512' }, CTX).plan.status).toBe('ok');
    expect(savedSearchForecastRequest({ q: '-computers' }, CTX).plan.status).toBe('needs_positive_scope');
  });

  it('fiscal-year policy: current + future FY only (the canonical default), never past years', () => {
    const p = savedSearchForecastRequest({ naics: '541512' }, CTX).plan;
    expect(p.policy.forecast.includePastFiscalYears).toBe(false);
    const op = fyOp(p.horizons.forecast.ops);
    expect(op?.expr).toContain('fiscal_year.ilike.%2026%');
    expect(op?.expr).not.toContain('%2025%');
  });

  it('plans are data: two runs of the same saved search build byte-identical plans', () => {
    const f = { q: 'fiber optic installation', horizons: { forecast: true } };
    expect(JSON.stringify(savedSearchForecastRequest(f, CTX).plan)).toBe(JSON.stringify(savedSearchForecastRequest(f, CTX).plan));
  });
});

describe('coverage states come from the canonical plan, never from a count', () => {
  it('unresolved publisher (NOAA/HUD/SBA/COMMERCE) → UNAVAILABLE, no query runs', async () => {
    for (const a of ['National Oceanic and Atmospheric Administration', 'HUD', 'SBA', 'COMMERCE']) {
      const { db, calls } = fakeDb({ data: [{ external_id: 'should-not-be-read' }] });
      const o = await fetchSavedSearchForecasts(db, { agency: a }, { ctx: CTX });
      expect(o.kind).toBe('unavailable');
      if (o.kind === 'unavailable') expect(o.gaps).toEqual([{ requested: a, reason: 'unresolved_publisher' }]);
      expect(calls.find((c) => c[0] === 'from')).toBeUndefined();
      expect(failsClosed(o.plan.horizons.forecast.ops)).toBe(true);
    }
  });

  it('known publisher without forecasts (FAA) → UNAVAILABLE with its own reason and the parent that publishes', async () => {
    const { db } = fakeDb({ data: [] });
    const o = await fetchSavedSearchForecasts(db, { agency: 'FAA' }, { ctx: CTX });
    expect(o.kind).toBe('unavailable');
    if (o.kind === 'unavailable') expect(o.gaps[0]).toMatchObject({ requested: 'FAA', reason: 'publisher_without_forecasts', parentWithData: 'DOT' });
    expect(forecastCoverageNotice(o)).toContain('not available for Federal Aviation Administration');
  });

  it('genuine covered zero → MEASURED with rows=[] (a real zero), no coverage notice', async () => {
    const { db, calls } = fakeDb({ data: [] });
    const o = await fetchSavedSearchForecasts(db, { agency: 'EPA', q: 'zzzxxyyqqq' }, { ctx: CTX });
    expect(o).toMatchObject({ kind: 'measured', coverage: 'ok', rows: [] });
    expect(forecastCoverageNotice(o)).toBeNull();
    expect(calls.find((c) => c[0] === 'from')?.[1]).toEqual(['agency_forecasts']);
    expect(calls.find((c) => c[0] === 'limit')?.[1]).toEqual([SAVED_SEARCH_FORECAST_WINDOW]);
    expect(calls.find((c) => c[0] === 'order')?.[1]).toEqual(['last_synced_at', { ascending: false }]);
  });

  it('partial → MEASURED from covered buyers only, gaps named, notice says "not a zero"', async () => {
    const { db } = fakeDb({ data: [{ external_id: 'F1' }] });
    const o = await fetchSavedSearchForecasts(db, { agency: 'VETERANS AFFAIRS|COMMERCE' }, { ctx: CTX });
    expect(o.kind).toBe('measured');
    if (o.kind !== 'measured') return;
    expect(o.coverage).toBe('partial');
    expect(o.coveredBuyers).toEqual(['VETERANS AFFAIRS']);
    expect(o.gaps).toEqual([{ requested: 'COMMERCE', reason: 'unresolved_publisher' }]);
    expect(o.plan.horizons.forecast.forecastFilters.agency).toBe('VETERANS AFFAIRS');
    const n = forecastCoverageNotice(o)!;
    expect(n).toContain('partial coverage');
    expect(n).toContain('Not measured: COMMERCE');
    expect(n).toContain('not a zero');
    expect(n).not.toMatch(/\b0\b|nothing found|found no|no upcoming/i);
  });

  it('query error → FAILED (unknown), never measured-zero', async () => {
    const { db } = fakeDb({ error: { message: 'canceling statement due to statement timeout' } });
    const o = await fetchSavedSearchForecasts(db, { naics: '541512' }, { ctx: CTX });
    expect(o.kind).toBe('failed');
    expect(forecastCoverageNotice(o)).toBeNull();
  });

  it('thrown transport error → FAILED, never measured-zero', async () => {
    const { db } = fakeDb({ throws: true });
    expect((await fetchSavedSearchForecasts(db, { naics: '541512' }, { ctx: CTX })).kind).toBe('failed');
  });

  it('a refused plan (nothing positive to search) → needs_refinement, not a measurement', async () => {
    const { db, calls } = fakeDb({ data: [] });
    const o = await fetchSavedSearchForecasts(db, { q: '-computers' }, { ctx: CTX });
    expect(o.kind).toBe('needs_refinement');
    expect(calls.find((c) => c[0] === 'from')).toBeUndefined();
    expect(forecastCoverageNotice(o)).toContain('not searched');
  });

  it('forecastOutcomeFromPlan is null for a measurable plan', () => {
    expect(forecastOutcomeFromPlan(buildDiscoveryPlan({ query: 'janitorial' }, SAVED_SEARCH_POLICY, CTX))).toBeNull();
  });
});

describe('a5f952c7 — locked acceptance fixture (15 departments incl. COMMERCE)', () => {
  const p = savedSearchForecastRequest(A5F952C7_FILTERS, CTX).plan;
  it('is PARTIAL: COMMERCE named missing as an unresolved publisher, never a zero', () => {
    expect(p.horizons.forecast.coverage).toBe('partial');
    expect(p.horizons.forecast.coverageGaps).toEqual([{ requested: 'COMMERCE', reason: 'unresolved_publisher' }]);
  });
  it('filters on exactly the 14 covered departments, ORed', () => {
    expect(p.horizons.forecast.forecastFilters.agency?.split('|')).toEqual(A5F952C7_COVERED);
  });
  it('"STATE, DEPARTMENT" resolves whole; the generic fragment "DEPARTMENT" is never a needle (#1672)', () => {
    expect(p.buyers.map((b) => b.requested)).toContain('STATE, DEPARTMENT');
    expect(p.horizons.forecast.forecastFilters.agency).not.toMatch(/(^|\|)DEPARTMENT(\||$)/);
  });
  it('keeps the saved NAICS and applies the FY policy', () => {
    expect(p.horizons.forecast.forecastFilters.naics).toBe('541511,541512,541513,541519,621,622,623');
    expect(fyOp(p.horizons.forecast.ops)).toBeTruthy();
  });
  it('renders a partial notice that counts the covered agencies and names COMMERCE', async () => {
    const { db } = fakeDb({ data: [] });
    const o = await fetchSavedSearchForecasts(db, A5F952C7_FILTERS, { ctx: CTX });
    expect(forecastCoverageNotice(o)).toBe(
      'Upcoming (forecast) buys: partial coverage. The forecasts here cover 14 of your 15 agencies. '
      + 'Not measured: COMMERCE. Mindy holds no forecast publisher for it, so this is not a zero.',
    );
  });
});

describe('engine switch — canonical is opt-in', () => {
  it('defaults to legacy; only the literal flag "true" or a read-only preview request selects canonical', () => {
    expect(resolveForecastEngine(undefined, false, null)).toBe('legacy');
    expect(resolveForecastEngine('1', false, null)).toBe('legacy');
    expect(resolveForecastEngine('on', false, 'canonical')).toBe('legacy');
    expect(resolveForecastEngine(undefined, false, 'canonical')).toBe('legacy');
    expect(resolveForecastEngine(undefined, true, 'canonical')).toBe('canonical');
    expect(resolveForecastEngine('true', false, null)).toBe('canonical');
  });
});
