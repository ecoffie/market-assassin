/**
 * "What's your ranking?" (owner, 2026-11-19): where a company's UEI stands among every federal
 * contractor by LIFETIME dollars obligated to it, overall and in its own state.
 *
 * Source: the per-UEI `recipients` table (one row per UEI, SUM(obligation_amount) over the whole
 * awards warehouse — scripts/usaspending-ingest/rebuild-recipients-from-awards.sql). So:
 *   - "lifetime" means "across the awards we hold", from the warehouse's earliest action date. The
 *     result carries `since` so the UI can say so — never an unqualified "all-time".
 *   - ranks are per UEI, exactly as asked. A company split across several UEIs is ranked on the one
 *     UEI in its Vault (the parent roll-up would be a different question).
 *   - only UEIs with positive lifetime dollars are ranked (de-obligations can net a UEI to ≤ 0).
 *
 * Honest failure (docs/agents/data-integrity.md): a UEI not in the table is `not_found` (its first
 * award may be newer than the last table rebuild) and a failed or cold query is `unavailable`.
 * Neither is ever turned into a rank or a zero.
 */
import { BQ_TABLES } from './client';
import { queryCached, bqUnavailable } from './cache';
export { topPercent } from '@/lib/ranking/top-percent';

export interface UeiRanking {
  uei: string;
  name: string | null;
  state: string | null;
  totalObligated: number;
  rankAll: number;
  countAll: number;
  rankState: number | null;
  countState: number | null;
  /** Earliest action date in the table (YYYY-MM-DD): what "lifetime" covers. */
  since: string | null;
  /** Latest action date in the table: how fresh the ranking is. */
  asOf: string | null;
}

export type UeiRankingResult =
  | { status: 'ok'; ranking: UeiRanking }
  | { status: 'not_found' }
  | { status: 'not_ranked'; totalObligated: number }
  | { status: 'unavailable' };

interface Row {
  recipient_name: string | null;
  state: string | null;
  total_obligated: number | null;
  rank_all: number | null;
  count_all: number | null;
  rank_state: number | null;
  count_state: number | null;
  since: string | null;
  as_of: string | null;
}

export const UEI_PATTERN = /^[A-Z0-9]{12}$/;

export function normalizeUei(raw: string | null | undefined): string | null {
  const u = (raw || '').trim().toUpperCase();
  return UEI_PATTERN.test(u) ? u : null;
}

export function toResult(rows: Row[], uei: string): UeiRankingResult {
  const r = rows[0];
  if (!r || r.total_obligated == null) return { status: 'not_found' };
  const total = Number(r.total_obligated);
  if (!(total > 0)) return { status: 'not_ranked', totalObligated: total };
  if (r.rank_all == null || r.count_all == null) return { status: 'unavailable' };
  return {
    status: 'ok',
    ranking: {
      uei,
      name: r.recipient_name,
      state: r.state,
      totalObligated: total,
      rankAll: Number(r.rank_all),
      countAll: Number(r.count_all),
      rankState: r.state && r.rank_state != null ? Number(r.rank_state) : null,
      countState: r.state && r.count_state != null ? Number(r.count_state) : null,
      since: r.since,
      asOf: r.as_of,
    },
  };
}

export async function getUeiRanking(rawUei: string): Promise<UeiRankingResult> {
  const uei = normalizeUei(rawUei);
  if (!uei) return { status: 'not_found' };
  const cacheKey = `uei-ranking:${uei}:v1`;
  const rows = await queryCached<Row>({
    cacheKey,
    cacheOnly: false, // signed-in Mindy surface: a cold miss may run the (small) query
    ttlSeconds: 24 * 60 * 60,
    // One scan of `recipients` (a few hundred thousand rows, five columns): every count is a
    // COUNTIF over the same pass, so no correlated subquery and no second read.
    query: `
      WITH me AS (
        SELECT recipient_name, state, total_obligated
        FROM ${BQ_TABLES.recipients}
        WHERE recipient_uei = @uei
        LIMIT 1
      )
      SELECT
        ANY_VALUE(me.recipient_name) AS recipient_name,
        ANY_VALUE(me.state) AS state,
        ANY_VALUE(me.total_obligated) AS total_obligated,
        COUNTIF(r.total_obligated > me.total_obligated) + 1 AS rank_all,
        COUNTIF(r.total_obligated > 0) AS count_all,
        COUNTIF(r.state = me.state AND r.total_obligated > me.total_obligated) + 1 AS rank_state,
        COUNTIF(r.state = me.state AND r.total_obligated > 0) AS count_state,
        CAST(MIN(r.first_action_date) AS STRING) AS since,
        CAST(MAX(r.last_action_date) AS STRING) AS as_of
      FROM me CROSS JOIN ${BQ_TABLES.recipients} r
    `,
    params: { uei },
  });
  if (rows.length === 0 && bqUnavailable(cacheKey, 0)) return { status: 'unavailable' };
  return toResult(rows, uei);
}
