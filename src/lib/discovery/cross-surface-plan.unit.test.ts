/**
 * CROSS-SURFACE QUERY-PLAN GATE (Phase B, 2026-09-22).
 *
 * The contract: for the same query, every discovery surface executes the SAME canonical plan
 * meaning. A surface may differ only in its declared POLICY (horizons, windows, fiscal years,
 * sources, recency) — never in how the query is interpreted.
 *
 * Registered surfaces and how each builds its plan. When a surface migrates onto
 * src/lib/discovery, set `status: 'migrated'` and give it a `toPlan` adapter that calls the
 * surface's REAL request→plan code. This gate then fails CI the moment that surface's meaning
 * drifts from MCP's — which is the reference.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiscoveryPlan, type DiscoveryPlan, type PlanContext } from './plan';
import { MCP_POLICY } from './policy';
import { mcpDiscoveryInput, mcpDiscoveryPolicy, type FindOpportunitiesInput } from '@/lib/opportunities/find-opportunities';
import { FIXTURES } from './__fixtures__/fixtures';
import { mapsOpenRequest } from '@/lib/opportunities/maps-open-discovery';
import { mapsRecompeteRequest } from '@/lib/recompete/maps-recompete-discovery';
import { mapsForecastRequest } from '@/lib/opportunities/maps-forecast-discovery';
import { savedSearchForecastRequest } from '@/lib/saved-searches/forecast-discovery';

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };

type Surface = {
  status: 'migrated' | 'pending';
  toPlan?: (f: FindOpportunitiesInput) => DiscoveryPlan;
  note: string;
  /**
   * A surface that migrated ONE horizon is gated on the shared interpretation plus that horizon only.
   * Omitted = every horizon.
   */
  horizon?: 'forecast';
  /**
   * The MCP input the reference plan is built from, when the surface by contract never receives part of it.
   * Omitted = the same input.
   */
  referenceInput?: (f: FindOpportunitiesInput) => FindOpportunitiesInput;
};

export const SURFACES: Record<string, Surface> = {
  mcp_find_opportunities: {
    status: 'migrated',
    toPlan: (f) => buildDiscoveryPlan(mcpDiscoveryInput(f), mcpDiscoveryPolicy(f), CTX),
    note: 'Reference surface (Phase B).',
  },
  maps_open: {
    status: 'migrated',
    // The REAL request→plan path of /api/app/opportunity-map: the same URL params the Maps client
    // sends, through the production adapter. MCP location → `state`, set_aside → `setAside`,
    // advanced.naics/psc → `naics`/`psc` (the Maps Filters-panel params).
    toPlan: (f) => mapsOpenRequest((k) => ({
      q: f.query, agency: f.agency, state: f.location, setAside: f.set_aside,
      naics: f.advanced?.naics, psc: f.advanced?.psc, status: 'active',
    } as Record<string, string | null | undefined>)[k] ?? null, { ctx: CTX }).plan,
    note: 'Phase C: /api/app/opportunity-map → maps-open-discovery.ts.',
  },
  maps_recompete: {
    status: 'migrated',
    // The REAL request→plan path of /api/app/recompete-map, fed the params the Maps client sends.
    // MCP set_aside is deliberately NOT mapped: on this horizon the Maps set-aside CHECKBOX is a surface
    // filter (group vocabulary SB/8A/HZ), not a canonical set-aside — see maps-recompete-discovery.ts.
    toPlan: (f) => mapsRecompeteRequest((k) => ({
      q: f.query, agency: f.agency, state: f.location, naics: f.advanced?.naics, psc: f.advanced?.psc,
    } as Record<string, string | null | undefined>)[k] ?? null, { ctx: CTX }).plan,
    note: 'Phase C2: /api/app/recompete-map → maps-recompete-discovery.ts.',
  },
  maps_forecast: {
    status: 'migrated',
    // The REAL request→plan path shared by /api/app/forecast-map and /api/forecasts/unplaced, fed the
    // params the Maps client sends (q / agency / state / naics; psc when present).
    toPlan: (f) => mapsForecastRequest((k) => ({
      q: f.query, agency: f.agency, state: f.location, naics: f.advanced?.naics, psc: f.advanced?.psc,
    } as Record<string, string | null | undefined>)[k] ?? null, { ctx: CTX }).plan,
    note: 'Phase C3: forecast-map + forecasts/unplaced → maps-forecast-discovery.ts.',
  },
  saved_searches_forecast: {
    status: 'migrated',
    horizon: 'forecast',
    // The REAL saved-search adapter, fed a saved filter set shaped like the one the map writes. A saved
    // PSC never reaches the Forecast builder (the map never sends psc to its Forecast horizon), so the
    // reference is MCP for the same request without advanced.psc.
    toPlan: (f) => savedSearchForecastRequest({
      q: f.query, agency: f.agency, state: f.location, naics: f.advanced?.naics, psc: f.advanced?.psc,
      horizons: { forecast: true },
    }, CTX).plan,
    referenceInput: (f) => ({ ...f, advanced: { ...f.advanced, psc: null } }),
    note: 'Forecast horizon: cron/saved-search-alerts → saved-searches/forecast-discovery.ts (engine behind SAVED_SEARCH_FORECAST_CANONICAL).',
  },
  saved_searches_open: { status: 'pending', note: 'Open half still runs parseMapFilters/applyMapFilters in cron/saved-search-alerts.' },
  daily_alerts: { status: 'pending', note: 'Profile-keyword path audited separately first.' },
};

/** The part of a plan that is MEANING (must match across surfaces). Policy is excluded on purpose. */
function meaning(p: DiscoveryPlan, horizon?: 'forecast') {
  const m = {
    status: p.status,
    intent: { ...p.intent },
    matcher: p.matcher,
    buyers: p.buyers,
    states: p.states,
    setAsides: p.setAsides,
    naics: p.naics,
    psc: p.psc,
    expansion: p.expansion,
    open_query_ops: p.horizons.open.ops,
    // Recompete MEANING = every op except the policy window bound (a timeframe is policy, not meaning).
    recompete_query_ops: p.horizons.recompete.ops.filter((o) => !(o.op === 'lte' && o.col === 'period_of_performance_current_end')),
    recompete_naics: p.horizons.recompete.naics,
    recompete_via: p.horizons.recompete.via,
    // Forecast MEANING = filters + every op except the fiscal-year policy clause (a timeframe is policy).
    forecast_filters: p.horizons.forecast.forecastFilters,
    forecast_query_ops: p.horizons.forecast.ops.filter((o) => !(o.op === 'or' && o.expr.startsWith('fiscal_year.is.null,'))),
    forecast_via: p.horizons.forecast.via,
    forecast_coverage: p.horizons.forecast.coverage,
    forecast_coverage_gaps: p.horizons.forecast.coverageGaps ?? null,
  };
  if (horizon !== 'forecast') return m;
  // Forecast-only surface: shared interpretation (a PSC is dropped by contract, so it is compared via the
  // reference input) + the Forecast horizon. Open/Recompete belong to the surface's pending halves.
  const { open_query_ops, recompete_query_ops, recompete_naics, recompete_via, ...rest } = m;
  void open_query_ops; void recompete_query_ops; void recompete_naics; void recompete_via;
  return rest;
}

const MCP_INPUTS: FindOpportunitiesInput[] = FIXTURES.map((f) => ({
  query: f.input.query,
  agency: f.input.agency ?? null,
  location: f.input.state ?? null,
  set_aside: f.input.setAside ?? null,
  advanced: { naics: f.input.naics ?? null, psc: f.input.psc ?? null },
}));

describe('cross-surface query-plan gate', () => {
  it('MCP executes exactly the canonical plan (MCP default policy) for every fixture', () => {
    for (const [i, f] of FIXTURES.entries()) {
      const viaMcp = SURFACES.mcp_find_opportunities.toPlan!(MCP_INPUTS[i]);
      const canonical = buildDiscoveryPlan(f.input, MCP_POLICY, CTX);
      expect(JSON.parse(JSON.stringify(viaMcp)), f.id).toEqual(JSON.parse(JSON.stringify(canonical)));
    }
  });

  it('MCP timeframe arguments change POLICY only, never meaning', () => {
    for (const input of MCP_INPUTS) {
      const base = SURFACES.mcp_find_opportunities.toPlan!(input);
      const narrowed = SURFACES.mcp_find_opportunities.toPlan!({ ...input, timeframe: { recompete_months: 6, forecast_include_past: true, open_closing_days: 14 } });
      expect(meaning(narrowed), input.query).toEqual(meaning(base));
    }
  });

  it('every MIGRATED surface interprets every fixture exactly as MCP does', () => {
    const ref = SURFACES.mcp_find_opportunities.toPlan!;
    for (const [name, s] of Object.entries(SURFACES)) {
      if (s.status !== 'migrated' || name === 'mcp_find_opportunities') continue;
      for (const input of MCP_INPUTS) {
        expect(meaning(s.toPlan!(input), s.horizon), `${name}: ${input.query}`)
          .toEqual(meaning(ref(s.referenceInput ? s.referenceInput(input) : input), s.horizon));
      }
    }
  });

  for (const [name, s] of Object.entries(SURFACES)) {
    if (s.status === 'pending') it.todo(`${name} — not yet on canonical discovery (${s.note})`);
  }

  it('Maps Open no longer interprets the query itself (route + adapter)', () => {
    const strip = (p: string) => readFileSync(p, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    const route = strip(join(__dirname, '..', '..', 'app', 'api', 'app', 'opportunity-map', 'route.ts'));
    const adapter = strip(join(__dirname, '..', 'opportunities', 'maps-open-discovery.ts'));
    // The route may not reach any legacy interpreter — not even the shared applyMapFilters, which
    // still runs the old search brain for callers that pass `search`.
    for (const legacy of ['applyMapFilters', 'parseMapFilters', 'buildSearchOr', 'resolveQueryIntent', 'agencyOrExpr', 'agencyIlikeConds', 'openCandidateOrExpr', 'keywordOrExpr', 'termOfArtNaicsCodes', 'rankSearchResults']) {
      expect(route, `route: ${legacy}`).not.toContain(legacy);
    }
    expect(route).toContain("from '@/lib/opportunities/maps-open-discovery'");
    // All three Open paths (headline count · unmapped count · viewport pins) go through ONE plan.
    expect(route.match(/mapsOpenRequest\(/g)).toHaveLength(1);
    expect(route.match(/applyFilters\((q|viewQ)\)/g)).toHaveLength(3);
    // The adapter hands applyMapFilters SURFACE filters only: the plan-owned keys are blanked.
    for (const legacy of ['buildSearchOr', 'resolveQueryIntent', 'agencyOrExpr', 'agencyIlikeConds']) expect(adapter, `adapter: ${legacy}`).not.toContain(legacy);
    expect(adapter).toMatch(/search: '',/);
    expect(adapter).toMatch(/agency: '',/);
    expect(adapter).toContain("from '@/lib/discovery'");
  });

  it('Maps Recompete no longer interprets the query itself (route + adapter)', () => {
    const strip = (p: string) => readFileSync(p, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    const route = strip(join(__dirname, '..', '..', 'app', 'api', 'app', 'recompete-map', 'route.ts'));
    const adapter = strip(join(__dirname, '..', 'recompete', 'maps-recompete-discovery.ts'));
    for (const legacy of ['termOfArtNaicsCodes', 'resolveQueryIntent', 'setAsideOrExpr', 'pscToNaicsCodes', 'agencyOrExpr', 'agencyIlikeConds',
      'multiAgency', 'naicsMatchConds', 'parseStateList', 'buildSearchOr', 'applyMapFilters', 'incumbent_name.ilike', "'period_of_performance_current_end', todayYmd"]) {
      expect(route, `route: ${legacy}`).not.toContain(legacy);
    }
    expect(route).toContain("from '@/lib/recompete/maps-recompete-discovery'");
    // One plan; all four reads (market total · unmapped · viewport pins · follow-ons) use it.
    expect(route.match(/mapsRecompeteRequest\(/g)).toHaveLength(1);
    // market total · unmapped · viewport pins read the table through applyFilters directly …
    expect(route.match(/applyFilters\(\s*db\.from\('recompete_opportunities'\)/g)).toHaveLength(3);
    // … and the follow-ons go through map-follow-ons.ts (Gate 1, planner-independent) with the SAME
    // applyFilters as their only filter — that module never interprets search meaning itself.
    expect(route).toContain('applyPlan: (q) => applyFilters(q),');
    const followOns = strip(join(__dirname, '..', 'recompete', 'map-follow-ons.ts'));
    for (const legacy of ['termOfArtNaicsCodes', 'resolveQueryIntent', 'buildSearchOr', 'applyMapFilters', 'imatch', '.or(', 'ilike']) {
      expect(followOns, `map-follow-ons: ${legacy}`).not.toContain(legacy);
    }
    expect(followOns).toContain('d.applyPlan(d.from().select(d.cols))');
    for (const legacy of ['termOfArtNaicsCodes', 'resolveQueryIntent', 'setAsideOrExpr', 'agencyOrExpr', 'naicsMatchConds', 'incumbent_name']) {
      expect(adapter, `adapter: ${legacy}`).not.toContain(legacy);
    }
    expect(adapter).toContain('applyRecompetePlan(query, req.plan)');
  });

  it('Maps Forecast no longer interprets the query itself (both routes + adapter)', () => {
    const strip = (p: string) => readFileSync(p, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    const map = strip(join(__dirname, '..', '..', 'app', 'api', 'app', 'forecast-map', 'route.ts'));
    const unplaced = strip(join(__dirname, '..', '..', 'app', 'api', 'forecasts', 'unplaced', 'route.ts'));
    const adapter = strip(join(__dirname, '..', 'opportunities', 'maps-forecast-discovery.ts'));
    const LEGACY = ['applyForecastFilters', 'resolveQueryIntent', 'keywordOrExpr', 'setAsideOrExpr', 'pscToNaicsCodes',
      'forecastAgencyOrExpr', 'resolveForecastAgencies', 'naicsMatchConds', 'parseStateList', 'buildSearchOr', 'excludePastFy', 'currentFiscalYear'];
    for (const [name, src] of [['forecast-map', map], ['forecasts/unplaced', unplaced], ['adapter', adapter]] as const) {
      for (const legacy of LEGACY) expect(src, `${name}: ${legacy}`).not.toContain(legacy);
    }
    for (const src of [map, unplaced]) expect(src).toContain("from '@/lib/opportunities/maps-forecast-discovery'");
    // forecast-map: ONE plan; pins, market count, unmapped count and unplaced rows all apply it.
    expect(map.match(/mapsForecastRequest\(/g)).toHaveLength(1);
    expect(map).toMatch(/getForecastViewportPins\([^)]*applyPlan\)/);
    expect(map).toMatch(/getUnplacedForecastRows\([^)]*applyPlan\)/);
    expect(map.match(/applyPlan\(\s*sb\(\)\.from\('agency_forecasts'\)/g)).toHaveLength(2);
    // unplaced: rows + facets through the same adapter (facets = same request minus agency only).
    expect(unplaced).toMatch(/forecastReq\.apply\(q\)/);
    expect(unplaced).toMatch(/mapsForecastRequest\(get, \{ dropAgency: true \}\)\.apply\(fq\)/);
    expect(adapter).toContain('applyForecastPlan(query, plan)');
  });

  it('MCP no longer carries its own matcher (no parallel interpretation can creep back)', () => {
    const src = readFileSync(join(__dirname, '..', 'opportunities', 'find-opportunities.ts'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    for (const legacy of ['buildSearchOr', 'openCandidateOrExpr', 'keywordOrExpr', 'agencyOrExpr', 'applyMapFilters', 'applyForecastFilters', 'resolveQueryIntent', 'termOfArtNaicsCodes', 'naicsMatchConds', 'dualBuyerOrExpr']) {
      expect(src, legacy).not.toContain(legacy);
    }
    expect(src).toContain("from '@/lib/discovery'");
  });
});
