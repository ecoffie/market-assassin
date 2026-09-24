/**
 * Saved Search FORECAST newness — the created_at watermark (2026-09-24).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 * A Forecast is NEW for a saved search iff ALL hold:
 *   1. it matches the search's canonical Discovery plan (full match set — no window, no row limit),
 *   2. its publisher is covered for this run,
 *   3. created_at ∈ (forecast_seen_through, snapshot]   (snapshot = one immutable DB time per interval),
 *   4. created_at > its publisher's alert floor (no floor row / suspended → never alertable),
 *   5. the interval is processed completely, so state may advance.
 *
 * last_synced_at plays NO part (a sync re-stamps ~900 rows with one timestamp every day, which made the legacy
 * "200 most recently synced" window an arbitrary slice of a tie — 92% false-new, measured 2026-09-23).
 * created_at is set once on insert and never rewritten, so re-syncs and amendments never make a row new.
 *
 * THREE LAYERS, kept separate (Eric, 2026-09-24):
 *   DISCOVERY   — which rows are new: the interval(s) below, read by KEYSET pagination over the unique, stable
 *                 tuple (created_at, id). Never OFFSET, never the whole result set in memory.
 *   PROGRESS    — `forecast_pending`: the fixed snapshot, one keyset cursor per segment, a running count and 3
 *                 evidence ids. It advances only past pages that were read successfully and is written only when
 *                 the run's state write succeeds, so a failure re-reads from the last durable cursor — no row is
 *                 dropped and no row is counted twice. The watermark moves only when EVERY segment is done.
 *   PRESENTATION— one email per completed interval: the count plus 3 evidence rows (the template never lists
 *                 more). A 25,000-row interval is one email that says 25,000, never 25,000 cards. Whether such a
 *                 volume should be emailed at all is an OPEN PRODUCT DECISION (record §4) — not invented here.
 *
 * PARTIAL COVERAGE. One global watermark is NOT enough: a buyer uncovered while the watermark advances would lose
 * the Forecasts created for it in that period (a permanent blind spot, test 11b). Each uncovered buyer keeps its own
 * catch-up boundary in `forecast_gap_since`; when it becomes covered its rows are read over (gap boundary, W] as a
 * separate segment, and its entry is cleared only when that segment completes.
 *
 * TIMESTAMPS are compared as exact microsecond values from their original text. A JS Date keeps milliseconds
 * only: rounding '…:38.208123' to '…:38.208Z' puts a row created AT a floor or a boundary on the wrong side of it.
 */
import { contextFor, type DiscoveryPlan, type ForecastCoverageGap, type PlanContext } from '@/lib/discovery';
import type { ForecastRowForAlert } from '@/lib/alerts/forecast-alert-row';
import { savedSearchForecastRequest, FORECAST_ALERT_COLS } from './forecast-discovery';
import type { SavedSearchFilters } from './types';

// ─── timestamps ─────────────────────────────────────────────────────────────────────────────────────────────────
const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;
/** Exact microseconds since the epoch, from timestamptz text. Throws on anything that is not a timestamp. */
export function tsMicros(s: string): bigint {
  const m = TS_RE.exec(String(s).trim());
  if (!m) throw new Error(`not a timestamp: ${s}`);
  let tz = m[4];
  if (tz !== 'Z' && tz.length === 3) tz = `${tz}:00`;
  const ms = Date.parse(`${m[1]}T${m[2]}${tz === 'Z' ? 'Z' : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz}`);
  if (Number.isNaN(ms)) throw new Error(`not a timestamp: ${s}`);
  return BigInt(ms) * BigInt(1000) + BigInt((m[3] ?? '').padEnd(6, '0').slice(0, 6));
}
export const tsAfter = (a: string, b: string) => tsMicros(a) > tsMicros(b);
export function isTimestamp(s: unknown): s is string {
  try { tsMicros(String(s)); return true; } catch { return false; }
}

// ─── state ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type KeysetCursor = { created_at: string; id: string };
export type ForecastSegment = {
  key: string;                 // 'main' | 'gap:<saved buyer>'
  buyer: string | null;        // null = the whole saved search (all covered buyers)
  from: string;                // exclusive
  to: string;                  // inclusive
  after: KeysetCursor | null;  // last row durably processed in this segment
  done: boolean;
};
export type ForecastPending = {
  snapshot: string;
  segments: ForecastSegment[];
  processed: number;           // rows discovered so far in this interval (all segments)
  evidence: string[];          // agency_forecasts.id, first 3 discovered — what the email shows
  commit: { seenThrough: string; gapSince: Record<string, string> | null };
};
export type ForecastWatermarkState = {
  seenThrough: string | null;
  gapSince: Record<string, string> | null;
  pending?: ForecastPending | null;
};

export type PublisherFloor = { source_agency: string; state: 'active' | 'suspended'; alertable_after: string | null };

/**
 * Keyset page size and per-evaluation page budget (20,000 rows/run). Bounded memory (one page), bounded work.
 * ⚠️ PostgREST caps EVERY response at SERVER_ROW_CAP rows whatever `limit` asks for. A page of 1,000 plus the
 * look-ahead row asks for 1,001, gets 1,000, and would read as "no more pages" — measured on production 2026-09-24:
 * 1,018 of 2,018 rows silently dropped. So pages stay well below the cap, and a capped response always means "more".
 */
export const SERVER_ROW_CAP = 1000;
export const FORECAST_PAGE_SIZE = 500;
export const FORECAST_MAX_PAGES_PER_RUN = 40;
export const FORECAST_EVIDENCE = 3;

export type ForecastRunPlan =
  | { mode: 'baseline'; nextState: ForecastWatermarkState }
  | { mode: 'unavailable'; gaps: ForecastCoverageGap[] }
  | { mode: 'refused'; refinement: string | null }
  | { mode: 'process'; pending: ForecastPending; resumed: boolean; coverage: 'ok' | 'partial'; gaps: ForecastCoverageGap[]; coveredBuyers: string[] };

/**
 * The state machine. Pure: given the stored state, this run's canonical plan and a fresh snapshot, decide what to
 * read. An interval in progress is ALWAYS resumed with its own snapshot before a new one can start.
 */
export function planForecastRun(state: ForecastWatermarkState, plan: DiscoveryPlan, snapshot: string): ForecastRunPlan {
  const f = plan.horizons.forecast;
  const gaps = f.coverageGaps ?? [];
  const gapNames = new Set(gaps.map((g) => g.requested));
  const covered = f.forecastFilters.agency ? f.forecastFilters.agency.split('|') : [];
  const coverage: 'ok' | 'partial' = f.coverage === 'partial' ? 'partial' : 'ok';

  if (state.pending) return { mode: 'process', pending: state.pending, resumed: true, coverage, gaps, coveredBuyers: covered };

  // Never measured by this engine: establish the boundary silently. Nothing that exists now is new, and every
  // currently-uncovered buyer starts from the same boundary.
  if (!state.seenThrough) {
    const gapSince: Record<string, string> = {};
    for (const g of gapNames) gapSince[g] = snapshot;
    return { mode: 'baseline', nextState: { seenThrough: snapshot, gapSince: Object.keys(gapSince).length ? gapSince : null, pending: null } };
  }
  if (plan.status !== 'ok') return { mode: 'refused', refinement: plan.refinement };
  // Unavailable: nothing is measured, so NOTHING advances.
  if (f.coverage === 'unestablished') return { mode: 'unavailable', gaps };

  const W = state.seenThrough;
  const prior = state.gapSince ?? {};
  const segments: ForecastSegment[] = [];
  const next = tsAfter(snapshot, W) ? snapshot : W;
  if (tsAfter(snapshot, W)) segments.push({ key: 'main', buyer: null, from: W, to: snapshot, after: null, done: false });
  // Buyers uncovered on an earlier run and covered now: their missed interval, as its own segment.
  for (const [buyer, since] of Object.entries(prior)) {
    if (covered.includes(buyer) && tsAfter(W, since)) segments.push({ key: `gap:${buyer}`, buyer, from: since, to: W, after: null, done: false });
  }
  // Still uncovered → keep the boundary it already had; newly uncovered → measured through W. A covered buyer's
  // entry is dropped here and takes effect only when the whole interval (incl. its catch-up) commits.
  const nextGap: Record<string, string> = {};
  for (const g of gapNames) nextGap[g] = prior[g] ?? W;
  return {
    mode: 'process', resumed: false, coverage, gaps, coveredBuyers: covered,
    pending: { snapshot: next, segments, processed: 0, evidence: [], commit: { seenThrough: next, gapSince: Object.keys(nextGap).length ? nextGap : null } },
  };
}

/**
 * Publisher floors as ONE PostgREST `.or()` body. Only ACTIVE floors admit rows, and only rows created after the
 * floor. No active floor → a never-matching predicate (fail closed), never "no filter". Floor text is used exactly
 * as stored (microsecond precision), never re-formatted through Date.
 */
export function floorOrExpr(floors: readonly PublisherFloor[]): string {
  const parts = floors
    .filter((p) => p.state === 'active' && p.alertable_after && isTimestamp(p.alertable_after))
    .map((p) => `and(source_agency.eq.${quote(p.source_agency)},created_at.gt.${p.alertable_after})`);
  return parts.length ? parts.join(',') : 'id.is.null';
}
function quote(v: string): string {
  if (v.includes('"')) throw new Error(`publisher code must not contain a quote: ${v}`);
  return /[,()\s.]/.test(v) ? `"${v}"` : v;
}

/** JS mirror of the SQL predicate (tests, replay cross-check). */
export function isForecastCandidate(
  row: { source_agency: string | null; created_at: string },
  interval: { from: string; to: string },
  floors: readonly PublisherFloor[],
): boolean {
  if (!tsAfter(row.created_at, interval.from) || tsAfter(row.created_at, interval.to)) return false;
  const fl = floors.find((p) => p.source_agency === row.source_agency);
  return !!fl && fl.state === 'active' && !!fl.alertable_after && tsAfter(row.created_at, fl.alertable_after);
}

/** Keyset predicate: strictly after (created_at, id). */
export function keysetAfterExpr(c: KeysetCursor): string {
  if (!isTimestamp(c.created_at) || !/^[0-9a-f-]{8,}$/i.test(c.id)) throw new Error('invalid keyset cursor');
  return `created_at.gt.${c.created_at},and(created_at.eq.${c.created_at},id.gt.${c.id})`;
}

export type CandidateRow = ForecastRowForAlert & { id?: string; source_agency?: string | null; created_at?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function segmentQuery(db: any, filters: SavedSearchFilters, seg: ForecastSegment, floors: readonly PublisherFloor[], ctx: PlanContext, cols: string, pageSize: number) {
  const req = savedSearchForecastRequest(seg.buyer ? { ...filters, agency: seg.buyer } : filters, ctx);
  let q = req.apply(db.from('agency_forecasts').select(cols))
    .gt('created_at', seg.from)
    .lte('created_at', seg.to)
    .or(floorOrExpr(floors));
  if (seg.after) q = q.or(keysetAfterExpr(seg.after));
  // pageSize + 1: the extra row only tells us whether another page exists, so the last full page closes its
  // segment instead of costing a whole extra run to read an empty page.
  return q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(pageSize + 1);
}

/**
 * Advance a pending interval by at most `maxPages` keyset pages. Pure with respect to state: returns the NEW
 * pending; nothing is persisted here. A read error returns `failed` and the caller keeps the previous pending.
 */
export async function advanceForecastInterval(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, filters: SavedSearchFilters, pending: ForecastPending, floors: readonly PublisherFloor[], ctx: PlanContext,
  budget: { pageSize?: number; maxPages?: number; onRows?: (rows: Array<{ id: string; created_at: string }>, segment: string) => void } = {},
): Promise<{ pending: ForecastPending; complete: boolean; pagesRead: number } | { error: string }> {
  const pageSize = Math.min(budget.pageSize ?? FORECAST_PAGE_SIZE, SERVER_ROW_CAP - 1);
  const maxPages = budget.maxPages ?? FORECAST_MAX_PAGES_PER_RUN;
  const next: ForecastPending = JSON.parse(JSON.stringify(pending));
  let pages = 0;
  try {
    for (const seg of next.segments) {
      while (!seg.done && pages < maxPages) {
        const { data, error } = await segmentQuery(db, filters, seg, floors, ctx, 'id, created_at', pageSize);
        if (error) return { error: error.message || 'forecast candidate query failed' };
        pages++;
        const got = (data ?? []) as Array<{ id: string; created_at: string }>;
        // A response at the server cap is truncated, never proof of the end.
        const more = got.length > pageSize || got.length >= SERVER_ROW_CAP;
        const rows = more ? got.slice(0, pageSize) : got;
        for (const r of rows) {
          if (next.evidence.length < FORECAST_EVIDENCE) next.evidence.push(r.id);
        }
        budget.onRows?.(rows, seg.key); // observer only (tests / replay) — never state
        next.processed += rows.length;
        if (rows.length) seg.after = { created_at: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
        if (!more) seg.done = true;
      }
      if (pages >= maxPages && !seg.done) break;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { pending: next, pagesRead: pages, complete: next.segments.every((s) => s.done) };
}

export type ForecastWatermarkOutcome =
  | { kind: 'baseline'; nextState: ForecastWatermarkState; snapshot: string }
  | { kind: 'unavailable'; gaps: ForecastCoverageGap[]; plan: DiscoveryPlan }
  | { kind: 'needs_refinement'; refinement: string | null; plan: DiscoveryPlan }
  | { kind: 'failed'; error: string }
  | { kind: 'in_progress'; nextState: ForecastWatermarkState; processed: number; coverage: 'ok' | 'partial'; gaps: ForecastCoverageGap[]; coveredBuyers: string[]; plan: DiscoveryPlan }
  | {
      kind: 'measured'; coverage: 'ok' | 'partial'; count: number; evidence: CandidateRow[]; gaps: ForecastCoverageGap[];
      coveredBuyers: string[]; nextState: ForecastWatermarkState; snapshot: string; plan: DiscoveryPlan; catchUpBuyers: string[];
    };

/**
 * One saved search's Forecast horizon under the watermark model. Reads only.
 * `snapshot` is captured by the caller once, at the start of the evaluation; it is used only when a NEW interval
 * starts (a resumed interval keeps its own).
 */
export async function evaluateForecastWatermark(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  filters: SavedSearchFilters,
  state: ForecastWatermarkState,
  opts: {
    snapshot: string; floors: readonly PublisherFloor[]; ctx?: PlanContext; pageSize?: number; maxPages?: number;
    onRows?: (rows: Array<{ id: string; created_at: string }>, segment: string) => void;
  },
): Promise<ForecastWatermarkOutcome> {
  const ctx = opts.ctx ?? contextFor(new Date(Number(tsMicros(opts.snapshot) / BigInt(1000))));
  const plan = savedSearchForecastRequest(filters, ctx).plan;
  const run = planForecastRun(state, plan, opts.snapshot);
  if (run.mode === 'baseline') return { kind: 'baseline', nextState: run.nextState, snapshot: opts.snapshot };
  if (run.mode === 'unavailable') return { kind: 'unavailable', gaps: run.gaps, plan };
  if (run.mode === 'refused') return { kind: 'needs_refinement', refinement: run.refinement, plan };

  const adv = await advanceForecastInterval(db, filters, run.pending, opts.floors, ctx, { pageSize: opts.pageSize, maxPages: opts.maxPages, onRows: opts.onRows });
  if ('error' in adv) return { kind: 'failed', error: adv.error };
  const base = { coverage: run.coverage, gaps: run.gaps, coveredBuyers: run.coveredBuyers, plan };
  if (!adv.complete) {
    return { kind: 'in_progress', ...base, processed: adv.pending.processed, nextState: { seenThrough: state.seenThrough, gapSince: state.gapSince, pending: adv.pending } };
  }
  // Complete: fetch only the evidence rows the email shows.
  let evidence: CandidateRow[] = [];
  if (adv.pending.evidence.length) {
    const { data, error } = await db.from('agency_forecasts').select(`id, ${FORECAST_ALERT_COLS}, created_at`).in('id', adv.pending.evidence).limit(FORECAST_EVIDENCE);
    if (error) return { kind: 'failed', error: error.message || 'evidence read failed' };
    const order = new Map(adv.pending.evidence.map((id, i) => [id, i]));
    evidence = ((data ?? []) as CandidateRow[]).sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  }
  return {
    kind: 'measured', ...base, count: adv.pending.processed, evidence, snapshot: adv.pending.snapshot,
    catchUpBuyers: adv.pending.segments.filter((s) => s.buyer).map((s) => s.buyer!),
    nextState: { seenThrough: adv.pending.commit.seenThrough, gapSince: adv.pending.commit.gapSince, pending: null },
  };
}

/** DB snapshot (lagged now()), as exact text. A failure is a failed evaluation — never a guessed clock. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readForecastSnapshot(db: any): Promise<{ snapshot: string } | { error: string }> {
  const { data, error } = await db.rpc('saved_search_forecast_snapshot');
  if (error || !data || !isTimestamp(data)) return { error: error?.message || 'snapshot unavailable' };
  return { snapshot: String(data) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readPublisherFloors(db: any): Promise<{ floors: PublisherFloor[] } | { error: string }> {
  const { data, error } = await db.from('forecast_publisher_alert_floor').select('source_agency, state, alertable_after').range(0, 999);
  if (error) return { error: error.message };
  return { floors: (data ?? []) as PublisherFloor[] };
}

/** saved_searches columns ↔ state. Only read/written by the canonical engine. */
export function stateFromRow(row: { forecast_seen_through?: string | null; forecast_gap_since?: unknown; forecast_pending?: unknown }): ForecastWatermarkState {
  const g = row.forecast_gap_since;
  const p = row.forecast_pending as ForecastPending | null | undefined;
  return {
    seenThrough: row.forecast_seen_through ?? null,
    gapSince: g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, string>) : null,
    pending: p && typeof p === 'object' && Array.isArray(p.segments) ? p : null,
  };
}
export function stateToColumns(s: ForecastWatermarkState) {
  return { forecast_seen_through: s.seenThrough, forecast_gap_since: s.gapSince, forecast_pending: s.pending ?? null };
}
