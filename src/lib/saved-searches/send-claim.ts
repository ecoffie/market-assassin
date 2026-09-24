/**
 * Delivery guarantees for the CANONICAL saved-search engine (tasks/saved-search-forecast-watermark-2026-09-24.md §8).
 *
 * The email provider is not transactional with the database, so exactly-once delivery is not achievable. What this
 * module makes true — and only this — is:
 *
 *   1. OVERLAPPING EXECUTIONS send at most once per state. Every state write is a compare-and-set on the row's
 *      `last_alerted_at` (stamped by every evaluation, so it is the row's version). Before sending, a run takes a
 *      lease (`forecast_alert_claim_until`) with the same CAS; a second run that read the same state loses the CAS
 *      and skips (`skippedConcurrent`) — it neither sends nor writes.
 *   2. FAILURE BEFORE SEND (or a rejected send) changes no alert state: the lease is released and the interval is
 *      re-evaluated by the next run. No loss.
 *   3. SEND SUCCEEDED, STATE SAVE FAILED: the save is retried once. If it still fails, the lease stays in place, so
 *      no run re-sends for FORECAST_SEND_LEASE_MS; after the lease expires the next run re-evaluates from the old
 *      state and the SAME interval is emailed again. This is the one duplicate the design accepts —
 *      AT-LEAST-ONCE, never silent loss — and it is reported as `state_update_failed`.
 *   4. A save lost to a concurrent writer (CAS miss) never regresses newer state (e.g. a slower run's earlier
 *      snapshot overwriting a later watermark).
 *
 * The LEGACY engine (flag OFF) is unchanged and has none of these guarantees: overlapping legacy runs can both send.
 */
export const FORECAST_SEND_LEASE_MS = 10 * 60 * 1000;

export type ClaimableRow = { id: string; last_alerted_at: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function atVersion(q: any, row: ClaimableRow) {
  return row.last_alerted_at == null ? q.is('last_alerted_at', null) : q.eq('last_alerted_at', row.last_alerted_at);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unclaimed(q: any, nowIso: string) {
  return q.or(`forecast_alert_claim_until.is.null,forecast_alert_claim_until.lt.${nowIso}`);
}

/** Take the send lease iff the row is still at the version this run read and nobody holds an unexpired lease. */
export async function claimSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, row: ClaimableRow, now: Date = new Date(),
): Promise<{ claimed: true; until: string } | { claimed: false; reason: 'concurrent' | 'error'; error?: string }> {
  const until = new Date(now.getTime() + FORECAST_SEND_LEASE_MS).toISOString();
  const q = db.from('saved_searches').update({ forecast_alert_claim_until: until }, { count: 'exact' }).eq('id', row.id);
  const { count, error } = await unclaimed(atVersion(q, row), now.toISOString());
  if (error) return { claimed: false, reason: 'error', error: error.message };
  if (count === 1) return { claimed: true, until };
  if (count === 0) return { claimed: false, reason: 'concurrent' };
  return { claimed: false, reason: 'error', error: `claim count unknown (${count})` };   // null ≠ 0
}

/** Give the lease back after a failed/rejected send, so the next run retries immediately. Best effort. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function releaseClaim(db: any, id: string, until: string): Promise<void> {
  await db.from('saved_searches').update({ forecast_alert_claim_until: null }).eq('id', id).eq('forecast_alert_claim_until', until);
}

/**
 * Write evaluation state with a compare-and-set.
 *   claim given → the row must still carry OUR lease (and version); the lease is cleared in the same write.
 *   no claim    → the row must be at the version read and not under anyone's unexpired lease.
 */
export async function saveEvaluation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, row: ClaimableRow, updates: Record<string, unknown>, opts: { claim?: string; now?: Date } = {},
): Promise<'saved' | 'concurrent' | 'error'> {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString();
  let q = db.from('saved_searches')
    .update({ ...updates, last_alerted_at: stamp, updated_at: stamp, forecast_alert_claim_until: null }, { count: 'exact' })
    .eq('id', row.id);
  q = atVersion(q, row);
  q = opts.claim ? q.eq('forecast_alert_claim_until', opts.claim) : unclaimed(q, stamp);
  const { count, error } = await q;
  if (error) return 'error';
  if (count === 1) return 'saved';
  return count === 0 ? 'concurrent' : 'error';
}
