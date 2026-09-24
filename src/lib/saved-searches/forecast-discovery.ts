/**
 * Saved Search → Canonical Discovery, FORECAST horizon (2026-09-23).
 *
 * The smallest adapter that turns a stored saved search into the canonical Forecast request/plan.
 * It owns NO search semantics. Query interpretation, agency resolution, concept expansion, forecast
 * publisher resolution, coverage and the fiscal-year policy all come from src/lib/discovery through
 * forecastDiscoveryRequest — the SAME builder the Maps Forecast horizon uses (maps-forecast-discovery.ts).
 *
 * What stays Saved-Search-specific, and lives here or in the cron:
 *   - which saved keys feed the Forecast request (exactly the keys the map sends to its Forecast
 *     horizon, so an alert and the restored ?ss= map agree),
 *   - the alert retrieval window (200 most recently synced, as the legacy cron),
 *   - turning the plan's coverage into an alert-layer outcome that can never collapse into zero.
 *
 * Saved search definitions are read, never rewritten.
 */
import { contextFor, SAVED_SEARCH_POLICY, type DiscoveryPlan, type ForecastCoverageGap, type PlanContext } from '@/lib/discovery';
import { forecastDiscoveryRequest, type MapsForecastRequest } from '@/lib/opportunities/maps-forecast-discovery';
import type { ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';
import type { SavedSearchFilters } from './types';

/**
 * The saved keys that shape the Forecast horizon — the keys the map client sends to
 * /api/app/forecast-map (opportunity-map/route.ts `_buildOppUrl`, m==='forecast'): q, agency, naics,
 * state. It also sends `setAside`, which the canonical Forecast builder does not read. It never sends
 * `psc` for Forecast, so a saved PSC must not reach the builder here either: the builder would
 * crosswalk it to NAICS and the alert would watch a different market than the restored map shows.
 */
export const SAVED_SEARCH_FORECAST_KEYS = ['q', 'agency', 'naics', 'state'] as const;

/**
 * Saved filters that already define a market on their own, so an exclusion-only `q` ("-computers")
 * is anchored by the surface (DiscoveryInput.hasSurfaceScope). Same list the #1664 replay used.
 */
const SURFACE_SCOPE_KEYS = ['naics', 'psc', 'agency', 'state', 'strategy', 'setAside', 'setAsideMulti', 'noticeMulti', 'noticeType', 'subAgency', 'fullOpen', 'sapBuyer', 'fsc'];

export type ForecastEngine = 'legacy' | 'canonical';

/**
 * Which Forecast engine the saved-search cron runs. canonical only on the literal flag value 'true'
 * (the repo's flag convention: '1'/'on' stay OFF), or for a read-only preview that asks for it. A
 * preview never writes or sends, so it is the safe way to inspect the canonical engine on production
 * without enabling it. Default: legacy.
 */
export function resolveForecastEngine(env: string | undefined, preview: boolean, requested: string | null): ForecastEngine {
  if (env === 'true') return 'canonical';
  if (preview && requested === 'canonical') return 'canonical';
  return 'legacy';
}

/** Alert retrieval window — unchanged from the legacy cron (most recently synced first). */
export const SAVED_SEARCH_FORECAST_WINDOW = 200;

export const FORECAST_ALERT_COLS = 'external_id, title, source_agency, department, contracting_office, naics_code, '
  + 'set_aside_type, fiscal_year, anticipated_quarter, anticipated_award_date, solicitation_date, '
  + 'estimated_value_max, estimated_value_range, pop_city, pop_state, last_synced_at';

function savedValue(filters: SavedSearchFilters, k: string): string | null {
  const v = (filters || {})[k];
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String).join(',');
  return typeof v === 'object' ? null : String(v);
}

export function savedSearchHasSurfaceScope(filters: SavedSearchFilters): boolean {
  const f = (filters || {}) as Record<string, unknown>;
  if (typeof f.scope === 'string' && f.scope.trim().toLowerCase() === 'profile') return true;
  return SURFACE_SCOPE_KEYS.some((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
}

/** One saved search → the canonical Forecast request (plan + applier) under SAVED_SEARCH_POLICY. */
export function savedSearchForecastRequest(filters: SavedSearchFilters, ctx?: PlanContext): MapsForecastRequest {
  const allowed = new Set<string>(SAVED_SEARCH_FORECAST_KEYS);
  return forecastDiscoveryRequest(
    (k) => (allowed.has(k) ? savedValue(filters, k) : null),
    SAVED_SEARCH_POLICY,
    { ctx: ctx ?? contextFor(), hasSurfaceScope: savedSearchHasSurfaceScope(filters) },
  );
}

/**
 * What the Forecast horizon produced for one saved search. Five states, never collapsed:
 *   measured/ok       — every requested buyer is covered. rows=[] IS a real measured zero.
 *   measured/partial  — rows come ONLY from covered buyers; `gaps` names the rest, which are not zero.
 *   unavailable       — no requested buyer has a forecast publisher. No measurement exists.
 *   needs_refinement  — the plan refused the query (nothing positive to search). Not a measurement.
 *   failed            — the query errored. Unknown, never zero; the caller must not advance state.
 */
export type ForecastHorizonOutcome =
  | { kind: 'measured'; coverage: 'ok' | 'partial'; rows: ForecastRowForAlert[]; gaps: ForecastCoverageGap[]; coveredBuyers: string[]; plan: DiscoveryPlan }
  | { kind: 'unavailable'; gaps: ForecastCoverageGap[]; plan: DiscoveryPlan }
  | { kind: 'needs_refinement'; refinement: string | null; plan: DiscoveryPlan }
  | { kind: 'failed'; error: string; plan: DiscoveryPlan };

/** Canonical state → alert outcome, before any query runs. Null = measurable, run the query. */
export function forecastOutcomeFromPlan(plan: DiscoveryPlan): Exclude<ForecastHorizonOutcome, { kind: 'measured' } | { kind: 'failed' }> | null {
  if (plan.status !== 'ok') return { kind: 'needs_refinement', refinement: plan.refinement, plan };
  const f = plan.horizons.forecast;
  if (f.coverage === 'unestablished') return { kind: 'unavailable', gaps: f.coverageGaps ?? [], plan };
  return null;
}

/**
 * Run the Forecast horizon of one saved search through the canonical plan.
 * ⚠️ NO map_lat bound: ~43% of forecasts have no coordinate and this alert is the only push channel
 * that reaches them (legacy cron rule, kept).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSavedSearchForecasts(db: any, filters: SavedSearchFilters, opts?: { ctx?: PlanContext; limit?: number }): Promise<ForecastHorizonOutcome> {
  const req = savedSearchForecastRequest(filters, opts?.ctx);
  const pre = forecastOutcomeFromPlan(req.plan);
  if (pre) return pre;
  const f = req.plan.horizons.forecast;
  const covered = f.forecastFilters.agency ? f.forecastFilters.agency.split('|') : [];
  let data: unknown;
  let error: { message?: string } | null = null;
  try {
    ({ data, error } = await req.apply(db.from('agency_forecasts').select(FORECAST_ALERT_COLS).limit(opts?.limit ?? SAVED_SEARCH_FORECAST_WINDOW))
      .order('last_synced_at', { ascending: false }));
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : String(e), plan: req.plan };
  }
  if (error) return { kind: 'failed', error: error.message || 'forecast query failed', plan: req.plan };
  return {
    kind: 'measured',
    coverage: f.coverage === 'partial' ? 'partial' : 'ok',
    rows: (Array.isArray(data) ? data : []) as ForecastRowForAlert[],
    gaps: f.coverageGaps ?? [],
    coveredBuyers: covered,
    plan: req.plan,
  };
}

function gapName(g: ForecastCoverageGap): string {
  return g.label || g.requested;
}

/**
 * Alert copy for a Forecast coverage state, derived from the canonical state and NEVER from a count.
 * Null = nothing to say (fully covered: the numbers speak for themselves). Only rendered alongside an
 * alert that has new matches — no email is sent to report a gap, which would be a new notification rule.
 */
export function forecastCoverageNotice(outcome: ForecastHorizonOutcome): string | null {
  if (outcome.kind === 'measured' && outcome.coverage === 'ok') return null;
  if (outcome.kind === 'measured') {
    // Joined with '; ' — saved agency names can carry a comma ("STATE, DEPARTMENT").
    const missing = outcome.gaps.map(gapName).join('; ');
    const covered = outcome.coveredBuyers.length;
    const total = covered + outcome.gaps.length;
    const from = covered <= 3 ? `only ${outcome.coveredBuyers.join('; ')}` : `${covered} of your ${total} agencies`;
    return `Upcoming (forecast) buys: partial coverage. The forecasts here cover ${from}. `
      + `Not measured: ${missing}. Mindy holds no forecast publisher for ${outcome.gaps.length === 1 ? 'it' : 'them'}, so this is not a zero.`;
  }
  if (outcome.kind === 'unavailable') {
    const missing = outcome.gaps.map(gapName).join('; ');
    return `Upcoming (forecast) buys: not available for ${missing}. Mindy holds no forecast publisher for `
      + `${outcome.gaps.length === 1 ? 'this buyer' : 'these buyers'}, so nothing was measured. This is not a zero.`;
  }
  if (outcome.kind === 'needs_refinement') {
    return 'Upcoming (forecast) buys: not searched. This saved search does not name anything to look for in forecasts.';
  }
  return null;
}
