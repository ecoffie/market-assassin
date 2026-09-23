/**
 * Maps Forecast adapter contract (Phase C3, 2026-09-23). Hermetic: a recording stub stands in for the
 * Supabase builder, so these assert exactly which predicates the two Maps Forecast routes send.
 */
import { describe, it, expect } from 'vitest';
import { mapsForecastRequest, mapsForecastDiscoveryMeta } from './maps-forecast-discovery';
import { buildDiscoveryPlan, MCP_POLICY, type PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
type Call = { m: string; a: unknown[] };
function stub() {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'gt', 'lt', 'or', 'in', 'not', 'lte', 'gte', 'neq', 'is', 'ilike']) q[m] = (...a: unknown[]) => { calls.push({ m, a }); return q; };
  return { q, calls };
}
const req = (params: Record<string, string>, dropAgency = false) =>
  mapsForecastRequest((k) => params[k] ?? null, { ctx: CTX, dropAgency });
const run = (params: Record<string, string>, dropAgency = false) => {
  const r = req(params, dropAgency);
  const s = stub();
  r.apply(s.q);
  return { r, calls: s.calls, ors: s.calls.filter((c) => c.m === 'or').map((c) => String(c.a[0])) };
};
const FY = (ors: string[]) => ors.find((e) => e.startsWith('fiscal_year.is.null,'));

describe('the Forecast market is the canonical plan (MCP is the reference)', () => {
  it('same ops and filters as MCP for every query shape', () => {
    for (const q of ['ai governance', 'janitorial', 'cybersecurity', 'SIEM', 'Show me USDA opportunities', '541512 -computers', 'R408', 'zzzxxyyqqq']) {
      const mcp = buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX).horizons.forecast;
      const maps = req({ q }).plan.horizons.forecast;
      expect(maps.ops, q).toEqual(mcp.ops);
      expect(maps.forecastFilters, q).toEqual(mcp.forecastFilters);
    }
  });
  it('free text is the whole-word matcher, never the legacy %substring% keyword split', () => {
    const { ors } = run({ q: 'ai governance' });
    expect(ors.join()).not.toMatch(/ilike\.%ai governance%/i);
    expect(ors.join()).toMatch(/governance/);
  });
  it('multi-agency: pipe list → distinct buyers, carried to the forecast identity resolver', () => {
    const r = req({ agency: 'USDA|VA' });
    expect(r.input.agency).toEqual(['USDA', 'VA']);
    expect(r.plan.horizons.forecast.forecastFilters.agency).toBe('USDA|VA');
  });
});

describe('fiscal-year policy: current + future FY by default (Eric, 2026-09-23)', () => {
  it('every Maps Forecast plan carries the canonical FY clause — null FY kept, past FY excluded', () => {
    const fy = FY(run({ q: 'janitorial' }).ors)!;
    expect(fy).toContain('fiscal_year.is.null');
    expect(fy).toContain('fiscal_year.ilike.%2026%');
    expect(fy).not.toContain('%2025%');
    expect(FY(run({}).ors)).toBeTruthy(); // even with no query
  });
  it('there is no Maps past-FY opt-in', () => {
    expect(req({ q: 'janitorial', includePast: '1', forecast_include_past: 'true' }).plan.policy.forecast.includePastFiscalYears).toBe(false);
    expect(mapsForecastDiscoveryMeta(req({}).plan).include_past_fiscal_years).toBe(false);
  });
});

describe('positive scope + fail-closed', () => {
  it('naked -computers → needs_positive_scope, and the query fails CLOSED', () => {
    const { r, calls } = run({ q: '-computers' });
    expect(r.plan.status).toBe('needs_positive_scope');
    expect(calls.some((c) => c.m === 'is' && c.a[0] === 'id' && c.a[1] === null)).toBe(true);
  });
  it.each(['541512 -computers', 'USDA -computers'])('%s is valid (canonical positive scope)', (q) => expect(req({ q }).plan.status).toBe('ok'));
  it('-computers + a NAICS filter is valid', () => expect(req({ q: '-computers', naics: '541512' }).plan.status).toBe('ok'));
});

describe('unplaced facets use the same request minus agency ONLY', () => {
  it('dropAgency removes the buyer and nothing else', () => {
    const full = req({ q: 'janitorial', naics: '561720', agency: 'VA' });
    const facet = req({ q: 'janitorial', naics: '561720', agency: 'VA' }, true);
    expect(facet.plan.buyers).toEqual([]);
    expect(facet.plan.horizons.forecast.forecastFilters.agency).toBeNull();
    expect(facet.plan.horizons.forecast.ops).toEqual(full.plan.horizons.forecast.ops);
    expect(facet.plan.horizons.forecast.forecastFilters.naics).toBe(full.plan.horizons.forecast.forecastFilters.naics);
  });
});

describe('discovery metadata', () => {
  it('reports status, via, FY policy and publisher coverage', () => {
    const m = mapsForecastDiscoveryMeta(req({ q: 'janitorial' }).plan);
    expect(m).toMatchObject({ status: 'ok', include_past_fiscal_years: false, coverage: 'ok' });
  });
});
