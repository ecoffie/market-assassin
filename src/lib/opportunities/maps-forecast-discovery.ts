/**
 * Maps Forecast → Canonical Discovery (Phase C3, 2026-09-23).
 *
 * The ONE place the Maps Forecast surface turns a request into a query. Two routes consume it and
 * both must interpret a query identically:
 *   /api/app/forecast-map     — viewport pins · market (drawable) count · unmapped count · unplaced list rows
 *   /api/forecasts/unplaced   — the location-less Forecast list + its agency facets
 *
 * The canonical plan (src/lib/discovery) owns what the Forecast market IS: free text (whole-word concept
 * matcher), agency identity (resolved forecast publisher codes; multi-select = OR), query-named NAICS /
 * PSC-crosswalk / set-aside / state, exclusions, and the fiscal-year policy (current + future FY by
 * default, exactly as MCP). Presentation stays in the routes: map_lat bound, bbox, ordering, pin cap,
 * unplaced-list gating and paging.
 *
 * The shared helpers (applyForecastFilters, getForecastViewportPins, getUnplacedForecastRows) are NOT
 * changed for anyone else: they take this adapter's applier only when a Maps Forecast route passes it,
 * so Saved Search alerts keep their current semantics until their own migration phase.
 *
 * Record: tasks/canonical-discovery-phase-c3-maps-forecast-2026-09-23.md
 */
import { buildDiscoveryPlan, applyForecastPlan, MAPS_POLICY, contextFor, type DiscoveryInput, type DiscoveryPlan, type PlanContext } from '@/lib/discovery';
import { multiAgency } from './agency-match';

type Get = (k: string) => string | null | undefined;

export interface MapsForecastRequest {
  input: DiscoveryInput;
  plan: DiscoveryPlan;
  /** Apply the canonical Forecast plan to an agency_forecasts query (no map_lat bound — callers own it). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (query: any) => any;
}

/**
 * Request params → one canonical Forecast plan under MAPS_POLICY (forecast: current + future FY).
 * `dropAgency` builds the SAME request without the agency filter — the unplaced list's agency facet
 * tally counts across agencies, as it always has.
 */
export function mapsForecastRequest(get: Get, opts?: { ctx?: PlanContext; dropAgency?: boolean }): MapsForecastRequest {
  const t = (k: string) => String(get(k) ?? '').trim();
  const agencies = opts?.dropAgency ? [] : multiAgency(get('agency') ?? '');
  const input: DiscoveryInput = {
    query: t('q') || t('search'),
    // One buyer stays a string (identical to MCP); a multi-select is a list of distinct buyers, ORed.
    agency: agencies.length > 1 ? agencies : agencies[0] ?? null,
    state: t('state') || null,
    naics: t('naics') || null,
    psc: t('psc') || null,
    // The Forecast surface has no Maps-only positive scope (it reads q / naics / agency / state only),
    // so an exclusion-only query is valid here only with a canonical scope (NAICS, agency, state …).
  };
  const plan = buildDiscoveryPlan(input, MAPS_POLICY, opts?.ctx ?? contextFor());
  return { input, plan, apply: (query) => applyForecastPlan(query, plan) };
}

/**
 * Additive `discovery` block. `coverage: 'unestablished'` means the requested buyer publishes no forecasts
 * we hold — MCP reports that horizon UNAVAILABLE, so a 0 here is not market truth either.
 */
export function mapsForecastDiscoveryMeta(plan: DiscoveryPlan) {
  return {
    version: plan.version, status: plan.status, refinement: plan.refinement, via: plan.horizons.forecast.via,
    coverage: plan.horizons.forecast.coverage, include_past_fiscal_years: plan.policy.forecast.includePastFiscalYears,
  };
}
