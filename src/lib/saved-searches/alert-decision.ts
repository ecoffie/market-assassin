/**
 * The saved-search alert DECISION — pure, and shared by both Forecast engines.
 *
 * Extracted from cron/saved-search-alerts without changing a rule:
 *   - FIRST RUN (never alerted, nothing seen): snapshot every current id as seen, send nothing.
 *   - A record is NEW when its id is not in last_seen_notice_ids. Forecasts key on external_id,
 *     SAM notices on notice_id (toAlertRow maps both onto `notice_id`).
 *   - NEW-RECORD ONLY: an updated or amended record keeps its id, so it is not new. Field-change
 *     alerts were deliberately not built (see the cron header).
 *   - After a successful send, seen = current ids first, then the prior seen ids, deduped, capped at 500.
 *   - No new records: nothing but last_alerted_at moves (the cron stamps that).
 *
 * The caller decides only on MEASURED records. A failed horizon never reaches here (the cron returns a
 * failure class and writes nothing); an unavailable horizon contributes no records and is not a zero.
 */
export const SAVED_SEARCH_SEEN_CAP = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AlertRecord = { notice_id?: string | null } & Record<string, any>;

export type SavedSearchAlertDecision =
  | { action: 'baseline'; nextSeen: string[] }
  | { action: 'no_new' }
  | { action: 'send'; fresh: AlertRecord[]; nextSeenAfterSend: string[] };

export function decideSavedSearchAlert(input: {
  lastAlertedAt: string | null;
  lastSeenIds: unknown;
  records: AlertRecord[];
}): SavedSearchAlertDecision {
  const seen = new Set(Array.isArray(input.lastSeenIds) ? (input.lastSeenIds as string[]) : []);
  const allIds = input.records.map((o) => o.notice_id).filter(Boolean) as string[];

  if (!input.lastAlertedAt && seen.size === 0) {
    return { action: 'baseline', nextSeen: [...new Set(allIds)].slice(0, SAVED_SEARCH_SEEN_CAP) };
  }

  const fresh = input.records.filter((o) => o.notice_id && !seen.has(o.notice_id));
  if (fresh.length === 0) return { action: 'no_new' };

  return {
    action: 'send',
    fresh,
    nextSeenAfterSend: [...new Set([...allIds, ...seen])].slice(0, SAVED_SEARCH_SEEN_CAP),
  };
}
