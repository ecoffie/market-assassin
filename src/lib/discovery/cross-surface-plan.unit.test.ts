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

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };

type Surface = { status: 'migrated' | 'pending'; toPlan?: (f: FindOpportunitiesInput) => DiscoveryPlan; note: string };

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
  maps_recompete: { status: 'pending', note: '/api/app/recompete-map (18-month policy).' },
  maps_forecast: { status: 'pending', note: '/api/app/forecast-map (current/future FY default).' },
  saved_searches: { status: 'pending', note: 'Gate: scripts/discovery-saved-search-blast.ts sign-off first.' },
  daily_alerts: { status: 'pending', note: 'Profile-keyword path audited separately first.' },
};

/** The part of a plan that is MEANING (must match across surfaces). Policy is excluded on purpose. */
function meaning(p: DiscoveryPlan) {
  return {
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
    recompete_via: p.horizons.recompete.via,
    forecast_via: p.horizons.forecast.via,
  };
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
      for (const input of MCP_INPUTS) expect(meaning(s.toPlan!(input)), `${name}: ${input.query}`).toEqual(meaning(ref(input)));
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

  it('MCP no longer carries its own matcher (no parallel interpretation can creep back)', () => {
    const src = readFileSync(join(__dirname, '..', 'opportunities', 'find-opportunities.ts'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    for (const legacy of ['buildSearchOr', 'openCandidateOrExpr', 'keywordOrExpr', 'agencyOrExpr', 'applyMapFilters', 'applyForecastFilters', 'resolveQueryIntent', 'termOfArtNaicsCodes', 'naicsMatchConds', 'dualBuyerOrExpr']) {
      expect(src, legacy).not.toContain(legacy);
    }
    expect(src).toContain("from '@/lib/discovery'");
  });
});
