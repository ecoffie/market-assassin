/**
 * Saved Search FORECAST newness — the created_at watermark (2026-09-24).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 * A Forecast is NEW for a saved search iff ALL hold:
 *   1. it matches the search's canonical Discovery plan (full match set — no window, no row limit),
 *   2. its publisher is covered for this run,
 *   3. created_at ∈ (forecast_seen_through, snapshot]   (snapshot = one immutable DB time per evaluation),
 *   4. created_at > its publisher's alert floor (no floor row / suspended → never alertable),
 *   5. the run completes, so state may advance.
 *
 * last_synced_at plays NO part: a sync re-stamps ~900 rows with one timestamp every day, which made the
 * legacy "200 most recently synced" window an arbitrary slice of a tie (92% false-new, measured 2026-09-23).
 * created_at is set once on insert and never rewritten, so re-sync and amendments never make a row new.
 *
 * PARTIAL COVERAGE. One global watermark is NOT enough: if a buyer is uncovered while the watermark
 * advances, Forecasts created for it in that period would fall behind the watermark and never be seen once
 * the buyer becomes covered (a permanent blind spot). So each uncovered buyer keeps its own catch-up
 * boundary in `forecast_gap_since`; when it becomes covered, its rows are read over (gap boundary, W] as
 * well as (W, snapshot]. State stays bounded by the number of saved buyers.
 */
import { contextFor, type DiscoveryPlan, type ForecastCoverageGap, type PlanContext } from '@/lib/discovery';
import type { ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';
import { savedSearchForecastRequest, FORECAST_ALERT_COLS } from './forecast-discovery';
import type { SavedSearchFilters } from './types';

export type ForecastWatermarkState = {
  seenThrough: string | null;
  gapSince: Record<string, string> | null;
};

export type PublisherFloor = { source_agency: string; state: 'active' | 'suspended'; alertable_after: string | null };

/** Candidates beyond this in ONE evaluation mean a publisher floor is missing — fail loudly, never advance. */
export const FORECAST_CANDIDATE_CEILING = 5000;

type Interval = { from: string; to: string };

export type ForecastRunPlan =
  | { mode: 'baseline'; nextState: ForecastWatermarkState }
  | { mode: 'unavailable'; gaps: ForecastCoverageGap[] }
  | { mode: 'refused'; refinement: string | null }
  | {
      mode: 'measure';
      main: Interval | null;
      catchUp: Array<{ buyer: string } & Interval>;
      coverage: 'ok' | 'partial';
      gaps: ForecastCoverageGap[];
      coveredBuyers: string[];
      nextState: ForecastWatermarkState;
    };

const later = (a: string, b: string) => new Date(a).getTime() > new Date(b).getTime();

/**
 * The state machine. Pure: given the stored state, this run's canonical plan and its snapshot, decide what
 * to read and what the state becomes IF the run succeeds. Nothing here writes.
 */
export function planForecastRun(state: ForecastWatermarkState, plan: DiscoveryPlan, snapshot: string): ForecastRunPlan {
  const f = plan.horizons.forecast;
  const gaps = f.coverageGaps ?? [];
  const gapNames = new Set(gaps.map((g) => g.requested));
  const covered = f.forecastFilters.agency ? f.forecastFilters.agency.split('|') : [];

  // Never measured by this engine: establish the boundary silently. Nothing that exists now is new, and
  // every currently-uncovered buyer starts from the same boundary.
  if (!state.seenThrough) {
    const gapSince: Record<string, string> = {};
    for (const g of gapNames) gapSince[g] = snapshot;
    return { mode: 'baseline', nextState: { seenThrough: snapshot, gapSince: Object.keys(gapSince).length ? gapSince : null } };
  }
  if (plan.status !== 'ok') return { mode: 'refused', refinement: plan.refinement };
  // Unavailable: nothing is measured, so NOTHING advances (the rule is explicit: no watermark move).
  if (f.coverage === 'unestablished') return { mode: 'unavailable', gaps };

  const W = state.seenThrough;
  const prior = state.gapSince ?? {};
  // Buyers that were uncovered on an earlier run and are covered now: read their missed interval.
  const catchUp = Object.entries(prior)
    .filter(([buyer, since]) => covered.includes(buyer) && later(W, since))
    .map(([buyer, since]) => ({ buyer, from: since, to: W }));
  const nextGap: Record<string, string> = {};
  // Still uncovered → keep the boundary it already had; newly uncovered → it was measured through W.
  for (const g of gapNames) nextGap[g] = prior[g] ?? W;
  return {
    mode: 'measure',
    main: later(snapshot, W) ? { from: W, to: snapshot } : null,
    catchUp,
    coverage: f.coverage === 'partial' ? 'partial' : 'ok',
    gaps,
    coveredBuyers: covered,
    nextState: { seenThrough: later(snapshot, W) ? snapshot : W, gapSince: Object.keys(nextGap).length ? nextGap : null },
  };
}

/**
 * Publisher floors as ONE PostgREST `.or()` body. Only ACTIVE floors admit rows, and only rows created
 * after the floor. No active floor → a never-matching predicate (fail closed), never "no filter".
 */
export function floorOrExpr(floors: readonly PublisherFloor[]): string {
  const parts = floors
    .filter((p) => p.state === 'active' && p.alertable_after)
    .map((p) => `and(source_agency.eq.${quote(p.source_agency)},created_at.gt.${new Date(p.alertable_after!).toISOString()})`);
  return parts.length ? parts.join(',') : 'id.is.null';
}
function quote(v: string): string {
  if (v.includes('"')) throw new Error(`publisher code must not contain a quote: ${v}`);
  return /[,()\s.]/.test(v) ? `"${v}"` : v;
}

/** JS mirror of the SQL predicate (tests, replay cross-check). */
export function isForecastCandidate(
  row: { source_agency: string | null; created_at: string },
  interval: Interval,
  floors: readonly PublisherFloor[],
): boolean {
  if (!later(row.created_at, interval.from) || later(row.created_at, interval.to)) return false;
  const fl = floors.find((p) => p.source_agency === row.source_agency);
  return !!fl && fl.state === 'active' && !!fl.alertable_after && later(row.created_at, fl.alertable_after);
}

export type CandidateRow = ForecastRowForAlert & { source_agency?: string | null; created_at?: string | null };

/** Every candidate in one interval for one request — paged in full, ordered by created_at then id. */
async function selectCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, filters: SavedSearchFilters, interval: Interval, floors: readonly PublisherFloor[], ctx: PlanContext,
): Promise<{ rows: CandidateRow[] } | { error: string }> {
  const req = savedSearchForecastRequest(filters, ctx);
  const rows: CandidateRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await req.apply(db.from('agency_forecasts').select(`${FORECAST_ALERT_COLS}, created_at`))
      .gt('created_at', interval.from)
      .lte('created_at', interval.to)
      .or(floorOrExpr(floors))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) return { error: error.message || 'forecast candidate query failed' };
    rows.push(...((data ?? []) as CandidateRow[]));
    if (rows.length > FORECAST_CANDIDATE_CEILING) return { error: `candidate_overflow:${rows.length}` };
    if (!data || data.length < 1000) break;
  }
  return { rows };
}

export type ForecastWatermarkOutcome =
  | { kind: 'baseline'; nextState: ForecastWatermarkState; snapshot: string }
  | { kind: 'unavailable'; gaps: ForecastCoverageGap[]; plan: DiscoveryPlan }
  | { kind: 'needs_refinement'; refinement: string | null; plan: DiscoveryPlan }
  | { kind: 'failed'; error: string }
  | {
      kind: 'measured'; coverage: 'ok' | 'partial'; rows: CandidateRow[]; gaps: ForecastCoverageGap[];
      coveredBuyers: string[]; nextState: ForecastWatermarkState; snapshot: string; plan: DiscoveryPlan;
      catchUpBuyers: string[];
    };

/**
 * One saved search's Forecast horizon under the watermark model. Reads only.
 * `snapshot` is captured by the caller ONCE, at the start of the evaluation.
 */
export async function evaluateForecastWatermark(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  filters: SavedSearchFilters,
  state: ForecastWatermarkState,
  opts: { snapshot: string; floors: readonly PublisherFloor[]; ctx?: PlanContext },
): Promise<ForecastWatermarkOutcome> {
  const ctx = opts.ctx ?? contextFor(new Date(opts.snapshot));
  const plan = savedSearchForecastRequest(filters, ctx).plan;
  const run = planForecastRun(state, plan, opts.snapshot);
  if (run.mode === 'baseline') return { kind: 'baseline', nextState: run.nextState, snapshot: opts.snapshot };
  if (run.mode === 'unavailable') return { kind: 'unavailable', gaps: run.gaps, plan };
  if (run.mode === 'refused') return { kind: 'needs_refinement', refinement: run.refinement, plan };

  const seen = new Set<string>();
  const out: CandidateRow[] = [];
  const add = (rows: CandidateRow[]) => {
    for (const r of rows) {
      const k = `${r.source_agency ?? ''}|${r.external_id ?? ''}`;
      if (!r.external_id || seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
  };
  try {
    if (run.main) {
      const m = await selectCandidates(db, filters, run.main, opts.floors, ctx);
      if ('error' in m) return { kind: 'failed', error: m.error };
      add(m.rows);
    }
    for (const c of run.catchUp) {
      // The same saved search, narrowed to the one recovered buyer, over the interval it missed.
      const m = await selectCandidates(db, { ...filters, agency: c.buyer }, c, opts.floors, ctx);
      if ('error' in m) return { kind: 'failed', error: m.error };
      add(m.rows);
    }
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
  if (out.length > FORECAST_CANDIDATE_CEILING) return { kind: 'failed', error: `candidate_overflow:${out.length}` };
  return {
    kind: 'measured', coverage: run.coverage, rows: out, gaps: run.gaps, coveredBuyers: run.coveredBuyers,
    nextState: run.nextState, snapshot: opts.snapshot, plan, catchUpBuyers: run.catchUp.map((c) => c.buyer),
  };
}

/** DB snapshot (lagged now()). A failure is a failed evaluation — never a guessed clock. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readForecastSnapshot(db: any): Promise<{ snapshot: string } | { error: string }> {
  const { data, error } = await db.rpc('saved_search_forecast_snapshot');
  if (error || !data) return { error: error?.message || 'snapshot unavailable' };
  return { snapshot: new Date(String(data)).toISOString() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readPublisherFloors(db: any): Promise<{ floors: PublisherFloor[] } | { error: string }> {
  const { data, error } = await db.from('forecast_publisher_alert_floor').select('source_agency, state, alertable_after').range(0, 999);
  if (error) return { error: error.message };
  return { floors: (data ?? []) as PublisherFloor[] };
}

/** saved_searches columns ↔ state. Only read/written by the canonical engine. */
export function stateFromRow(row: { forecast_seen_through?: string | null; forecast_gap_since?: unknown }): ForecastWatermarkState {
  const g = row.forecast_gap_since;
  return {
    seenThrough: row.forecast_seen_through ?? null,
    gapSince: g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, string>) : null,
  };
}
export function stateToColumns(s: ForecastWatermarkState): { forecast_seen_through: string | null; forecast_gap_since: Record<string, string> | null } {
  return { forecast_seen_through: s.seenThrough, forecast_gap_since: s.gapSince };
}
