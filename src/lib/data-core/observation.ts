/**
 * OBSERVATION MOAT — pure helpers for what Mindy remembers about how the market changed.
 *
 * Only APPEND-ONLY / point-in-time stores count as observation:
 *   recompete_changes        — every tracked contract field that moved, logged before the upsert
 *                              overwrote it (USASpending serves current state only, so these
 *                              cannot be re-derived later)
 *   daily_metric_snapshots   — the daily cumulative total of that log
 *   leaderboard_snapshots    — weekly point-in-time contractor rankings
 *   intelligence_changes     — changes to GAO-backed strategic intelligence (a different
 *                              KIND of change — never mixed into procurement counts)
 *
 * Deliberately EXCLUDED:
 *   daily_saved_search_snapshots — a customer's watchlist history, not platform observation
 *   mcp_external_cache           — a 24h OVERWRITE cache (Competition Health depth lives here);
 *                                  one row per key, replaced on refresh — it remembers nothing
 */

export type MovementClass = 'gained' | 'declined' | 'stable' | 'entered' | 'exited';

export interface RankRow {
  slug: string;
  recipient_uei: string;
  recipient_name: string | null;
  rank: number;
}

export interface Mover {
  slug: string;
  uei: string;
  name: string | null;
  from: number;
  to: number;
  delta: number; // positive = moved UP (smaller rank number)
}

export interface LeaderboardMovement {
  counts: Record<MovementClass, number>;
  topGainers: Mover[];
  topDecliners: Mover[];
  /** Lists present in BOTH snapshots — only these are compared. */
  comparedLists: number;
}

/**
 * Compare two point-in-time snapshots of the same ranked lists.
 *
 * Movement is only defined WITHIN a list (slug) present in both snapshots — a list that
 * appears or disappears between snapshots says nothing about any contractor, so it is
 * excluded rather than turned into a wave of "entered"/"exited". Within a compared list:
 *   gained / declined / stable — same contractor in both, rank changed or not
 *   entered — on the list now, not last time (entered the published top-N)
 *   exited  — on the list last time, not now
 */
export function classifyLeaderboardMovement(prev: RankRow[], latest: RankRow[], topN = 5): LeaderboardMovement {
  const key = (r: RankRow) => `${r.slug}\u0000${r.recipient_uei}`;
  const prevSlugs = new Set(prev.map((r) => r.slug));
  const latestSlugs = new Set(latest.map((r) => r.slug));
  const shared = new Set([...latestSlugs].filter((s) => prevSlugs.has(s)));

  const prevByKey = new Map(prev.filter((r) => shared.has(r.slug)).map((r) => [key(r), r]));
  const latestByKey = new Map(latest.filter((r) => shared.has(r.slug)).map((r) => [key(r), r]));

  const counts: Record<MovementClass, number> = { gained: 0, declined: 0, stable: 0, entered: 0, exited: 0 };
  const movers: Mover[] = [];
  for (const [k, now] of latestByKey) {
    const before = prevByKey.get(k);
    if (!before) { counts.entered++; continue; }
    const delta = before.rank - now.rank;
    if (delta > 0) counts.gained++;
    else if (delta < 0) counts.declined++;
    else counts.stable++;
    if (delta !== 0) {
      movers.push({ slug: now.slug, uei: now.recipient_uei, name: now.recipient_name, from: before.rank, to: now.rank, delta });
    }
  }
  for (const k of prevByKey.keys()) if (!latestByKey.has(k)) counts.exited++;

  return {
    counts,
    topGainers: movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, topN),
    topDecliners: movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, topN),
    comparedLists: shared.size,
  };
}

/** Human label for a tracked recompete field. Unknown fields keep their raw name. */
export const CHANGE_FIELD_LABEL: Record<string, string> = {
  potential_total_value: 'Contract value changed',
  period_of_performance_current_end: 'End date moved',
  incumbent_uei: 'Incumbent changed',
};
