/**
 * Players result truth states. A count of Players is a CLAIM, and `0` is only one of four
 * outcomes — it must never stand in for the other three.
 *
 *   success_nonzero      the query ran against a COMPLETE population and found firms
 *   success_zero         the query ran against a COMPLETE population and there are none (a TRUE zero)
 *   unavailable          the query failed / quota / cold cache — we do NOT know. Never render 0.
 *   coverage_incomplete  the query ran, but the population it read is known to be partial
 *                        (e.g. the legacy national top-50 list, or a filter applied after a cap).
 *                        Any count shown is a FLOOR, and a zero is not a zero.
 *
 * Audit: tasks/players-naics-coverage-audit-2026-10-04.md — a BQ quota failure, a 500, a network
 * error and a truncated source all rendered as "0 Players" (and one rendered sales copy).
 */
import type { BqResultState } from '@/lib/bigquery/cache';

export type PlayersStatus = 'success_nonzero' | 'success_zero' | 'unavailable' | 'coverage_incomplete';

/** Which population answered. */
export type PlayersSource =
  | 'players_canonical' // players_naics_recipients — full award-derived NAICS × UEI × state
  | 'top50_rollup'      // top_contractors_by_dimension — national top 50 per NAICS (SEO listicle)
  | 'recipients'        // recipients table — no NAICS scope (name/state search)
  | 'awards_scan';      // live awards scan (agency-scoped path)

export interface PlayersCoverage {
  source: PlayersSource;
  /** Why the result is not a complete population, when it is not. */
  incompleteReason?: string;
  /** awards MAX(action_date) the answering population was built from, when known. */
  sourceActionMax?: string | null;
}

/** Sources that are, by construction, a truncated population for a NAICS query. */
const TRUNCATED_SOURCES: ReadonlySet<PlayersSource> = new Set(['top50_rollup']);

export function classifyPlayersResult(input: {
  rowCount: number;
  bqState: BqResultState;
  source: PlayersSource;
  /** A filter was applied after a cap (e.g. set-aside over a bounded candidate pool). */
  postCapFilter?: boolean;
}): PlayersStatus {
  if (input.bqState === 'failed' || input.bqState === 'unavailable') return 'unavailable';
  if (TRUNCATED_SOURCES.has(input.source) || input.postCapFilter) return 'coverage_incomplete';
  return input.rowCount > 0 ? 'success_nonzero' : 'success_zero';
}

export const TOP50_INCOMPLETE_REASON =
  'Only the 50 largest firms nationally per NAICS are in this source; firms outside that list are missing.';

/**
 * Combine per-part statuses (one per state in a multi-state viewport, or companies + buyers).
 * Any unknown part makes the whole answer unknown unless other parts found rows — then it is a
 * FLOOR (coverage_incomplete), never a confident total.
 */
export function combinePlayersStatuses(parts: Array<{ status: PlayersStatus; rowCount: number }>): PlayersStatus {
  if (parts.length === 0) return 'success_zero';
  const anyUnavailable = parts.some((p) => p.status === 'unavailable');
  const anyIncomplete = parts.some((p) => p.status === 'coverage_incomplete');
  const anyRows = parts.some((p) => p.rowCount > 0);
  if (anyUnavailable) return anyRows ? 'coverage_incomplete' : 'unavailable';
  if (anyIncomplete) return 'coverage_incomplete';
  return anyRows ? 'success_nonzero' : 'success_zero';
}

/** Only a measured, complete-population zero may be rendered as "0". */
export function mayRenderZero(status: PlayersStatus): boolean {
  return status === 'success_zero';
}
