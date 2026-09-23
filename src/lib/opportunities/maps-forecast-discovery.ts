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
 * changed for anyone else: they take this adapter's applier only when a Maps Forecast route passes it.
 * Saved Search alerts reach the SAME builder (forecastDiscoveryRequest) under SAVED_SEARCH_POLICY — see
 * src/lib/saved-searches/forecast-discovery.ts.
 *
 * Record: tasks/canonical-discovery-phase-c3-maps-forecast-2026-09-23.md
 */
import { buildDiscoveryPlan, applyForecastPlan, MAPS_POLICY, contextFor, type DiscoveryInput, type DiscoveryPlan, type PlanContext, type SurfacePolicy } from '@/lib/discovery';
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
 * Request params → one canonical Forecast plan under a surface policy. The ONE request→plan builder for
 * the Forecast horizon: Maps calls it through mapsForecastRequest (MAPS_POLICY); Saved Search alerts call
 * it through savedSearchForecastRequest (SAVED_SEARCH_POLICY, src/lib/saved-searches/forecast-discovery.ts).
 * `dropAgency` builds the SAME request without the agency filter — the unplaced list's agency facet
 * tally counts across agencies, as it always has. `hasSurfaceScope` is set only by a surface that
 * already carries a positive scope the plan cannot see (a saved search's other filters).
 */
export function forecastDiscoveryRequest(
  get: Get,
  policy: SurfacePolicy,
  opts?: { ctx?: PlanContext; dropAgency?: boolean; hasSurfaceScope?: boolean },
): MapsForecastRequest {
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
    ...(opts?.hasSurfaceScope ? { hasSurfaceScope: true } : {}),
  };
  const plan = buildDiscoveryPlan(input, policy, opts?.ctx ?? contextFor());
  return { input, plan, apply: (query) => applyForecastPlan(query, plan) };
}

/** Request params → one canonical Forecast plan under MAPS_POLICY (forecast: current + future FY). */
export function mapsForecastRequest(get: Get, opts?: { ctx?: PlanContext; dropAgency?: boolean }): MapsForecastRequest {
  return forecastDiscoveryRequest(get, MAPS_POLICY, opts);
}

/**
 * Additive `discovery` block — the SAME coverage result MCP reads (canonical plan):
 *   coverage 'unestablished' — no requested buyer has a forecast publisher: UNAVAILABLE, counts are null.
 *   coverage 'partial'       — counts cover only the covered buyers; `coverage_gaps` names the rest.
 */
export function mapsForecastDiscoveryMeta(plan: DiscoveryPlan) {
  const f = plan.horizons.forecast;
  return {
    version: plan.version, status: plan.status, refinement: plan.refinement, via: f.via,
    coverage: f.coverage, include_past_fiscal_years: plan.policy.forecast.includePastFiscalYears,
    ...(f.coverageGaps?.length ? { coverage_gaps: f.coverageGaps } : {}),
  };
}

/** True when the Forecast horizon has no measurable coverage — every count must be null, never 0. */
export function forecastCoverageUnavailable(plan: DiscoveryPlan): boolean {
  return plan.horizons.forecast.coverage === 'unestablished';
}
