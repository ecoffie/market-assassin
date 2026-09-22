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

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };

type Surface = { status: 'migrated' | 'pending'; toPlan?: (f: FindOpportunitiesInput) => DiscoveryPlan; note: string };

export const SURFACES: Record<string, Surface> = {
  mcp_find_opportunities: {
    status: 'migrated',
    toPlan: (f) => buildDiscoveryPlan(mcpDiscoveryInput(f), mcpDiscoveryPolicy(f), CTX),
    note: 'Reference surface (Phase B).',
  },
  maps_open: { status: 'pending', note: 'Next: /api/app/opportunity-map → applyOpenPlan.' },
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

  it('MCP no longer carries its own matcher (no parallel interpretation can creep back)', () => {
    const src = readFileSync(join(__dirname, '..', 'opportunities', 'find-opportunities.ts'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    for (const legacy of ['buildSearchOr', 'openCandidateOrExpr', 'keywordOrExpr', 'agencyOrExpr', 'applyMapFilters', 'applyForecastFilters', 'resolveQueryIntent', 'termOfArtNaicsCodes', 'naicsMatchConds', 'dualBuyerOrExpr']) {
      expect(src, legacy).not.toContain(legacy);
    }
    expect(src).toContain("from '@/lib/discovery'");
  });
});
