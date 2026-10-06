/**
 * A FAILED Open search is not an EMPTY Open market (match-health audit, 2026-10-06).
 *
 * fetchSamOpportunitiesFromCache used to answer a PostgREST error with `{ opportunities: [] }`.
 * Seven keyword-only profiles (no NAICS, 4–11 keywords) hit `57014 statement timeout` on
 * every attempt, and the daily-alerts cron logged them
 *   skipped / no_new_or_active_opportunities
 * — a market claim nobody measured — and then treated them as done for the day.
 *
 * This module is the one definition of how such a failure is RECORDED and RETRIED:
 *
 *   - Recorded as  delivery_status='failed', error_message='open_search_failed:<code>'
 *     so every report that counts alert_log outcomes sees a failure, never a zero.
 *   - SAME-DAY retry: the cron's "already processed today" guard skips 'sent'/'skipped'/
 *     'failed' rows. A search failure is the one 'failed' row that is NOT final — the
 *     user is re-searched by later dispatcher runs the same day, at most
 *     MAX_SAME_DAY_OPEN_SEARCH_ATTEMPTS times (retry_count counts prior attempts), so a
 *     search that fails every time cannot eat the batch.
 *   - CROSS-DAY retry (retryFailedDailyAlerts) re-SENDS a stored payload. A search failure
 *     has no payload to send, so that loop leaves these rows alone instead of retiring them
 *     as `retry_skipped:no_payload` (which would overwrite the real reason). Tomorrow's
 *     normal run searches the user again from scratch.
 */

export const OPEN_SEARCH_FAILED_PREFIX = 'open_search_failed';
export const MAX_SAME_DAY_OPEN_SEARCH_ATTEMPTS = 3;

export interface OpenSearchError {
  code?: string | null;
  message: string;
}

/** `open_search_failed:57014 canceling statement due to statement timeout` (bounded length). */
export function openSearchFailureReason(err: OpenSearchError | null | undefined): string {
  const code = (err?.code || 'error').toString().trim() || 'error';
  const msg = (err?.message || '').toString().replace(/\s+/g, ' ').trim().slice(0, 160);
  return msg ? `${OPEN_SEARCH_FAILED_PREFIX}:${code} ${msg}` : `${OPEN_SEARCH_FAILED_PREFIX}:${code}`;
}

interface AlertLogOutcome {
  delivery_status?: string | null;
  error_message?: string | null;
  retry_count?: number | null;
}

export function isOpenSearchFailure(row: AlertLogOutcome | null | undefined): boolean {
  return !!row
    && row.delivery_status === 'failed'
    && typeof row.error_message === 'string'
    && row.error_message.startsWith(`${OPEN_SEARCH_FAILED_PREFIX}:`);
}

/** Attempts already made today for this row (1 after the first failure). */
export function openSearchAttempts(row: AlertLogOutcome): number {
  return Math.max(0, Number(row.retry_count) || 0) + 1;
}

/**
 * Should today's "already processed" guard let this user be searched again?
 * True only for an Open-search failure that has not yet used its same-day attempts.
 */
export function retryOpenSearchToday(row: AlertLogOutcome | null | undefined): boolean {
  return isOpenSearchFailure(row) && openSearchAttempts(row as AlertLogOutcome) < MAX_SAME_DAY_OPEN_SEARCH_ATTEMPTS;
}

/**
 * PARTIAL SEND (Eric, 2026-10-06): when the Open search is still failing on the FINAL same-day
 * attempt and another section has useful results (Coming Back cards or grants), the alert is
 * sent with the Open section replaced by OPEN_UNAVAILABLE_LINE — never a zero claim. The row is
 * recorded delivery_status='sent' with error_message `open_unavailable_partial:<code> …`:
 *   - 'sent' is final for the day (the same-day guard only re-admits isOpenSearchFailure rows),
 *   - the cross-day retry loop selects only 'failed' rows, so it can never re-send it,
 *   - the prefix keeps it distinguishable from a full send in every alert_log report.
 */
export const OPEN_UNAVAILABLE_PARTIAL_PREFIX = 'open_unavailable_partial';
export const OPEN_UNAVAILABLE_LINE = 'Open opportunities could not be checked today.';

/** `open_unavailable_partial:57014 … [sections=coming_back,grants attempts=3]` (bounded length). */
export function openUnavailablePartialNote(
  err: OpenSearchError | null | undefined,
  attempts: number,
  sections: string[],
): string {
  const base = openSearchFailureReason(err).slice(`${OPEN_SEARCH_FAILED_PREFIX}:`.length);
  return `${OPEN_UNAVAILABLE_PARTIAL_PREFIX}:${base} [sections=${sections.join(',')} attempts=${attempts}]`;
}

export function isOpenUnavailablePartial(row: AlertLogOutcome | null | undefined): boolean {
  return !!row && typeof row.error_message === 'string' && row.error_message.startsWith(`${OPEN_UNAVAILABLE_PARTIAL_PREFIX}:`);
}
