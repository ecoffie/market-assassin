/**
 * Which terminal status the DISPATCHER records on a run row whose route may already have
 * self-reported (src/lib/cron-self-report.ts).
 *
 * THE RACE THIS CLOSES
 * A long job's route that finishes inside the dispatcher's 12s ack window calls
 * reportCronOutcome() BEFORE it responds, and the dispatcher writes the run row AFTER the
 * response. The dispatcher's write used to win unconditionally, so:
 *   - a route that self-reported `partial` (searches still due) and answered 2xx was
 *     recorded as clean `success` with `error = null`;
 *   - a route that self-reported `success` with action items (`recipient_suppressed=3`)
 *     lost that summary to `error = null`;
 *   - a route that self-reported `error` with a class list lost it to "route returned 500".
 * Measured on saved-search-alerts (2026-11-21, PR #2234 review).
 *
 * THE RULE — the dispatcher may never record a CLEANER or LESS SPECIFIC outcome than the
 * route's own report:
 *   - Dispatcher saw a clean 2xx JSON (`success`) or stopped listening (`dispatched`) →
 *     keep the route's terminal self-report: it knows more (partial, error, action items).
 *   - Dispatcher saw a non-2xx whose HTTP status EQUALS the self-reported http_status →
 *     the two agree; keep the route's report (same severity, richer error text).
 *   - Anything else (no self-report, a 500 after a self-reported success, an HTML 200,
 *     a short-job timeout) → the dispatcher's observation wins, exactly as before.
 * So a disagreement can only make the record worse, never better.
 */

/** Statuses only the dispatcher writes; a row in one of these has not been self-reported. */
const NOT_SELF_REPORTED = new Set(['running', 'dispatched']);

export type DispatchObservation = {
  status: string;
  httpStatus: number | null;
  errorMsg: string | null;
  /** fetch Response.ok — false for non-2xx; true for any 2xx (including an HTML 200). */
  responseOk: boolean;
};

export type RunRowSnapshot = {
  status: string | null;
  http_status: number | null;
  error: string | null;
} | null;

export type DispatchFinal = {
  status: string;
  httpStatus: number | null;
  errorMsg: string | null;
  /** True when the route's own terminal report was kept instead of the dispatcher's. */
  keptSelfReport: boolean;
};

export function resolveDispatchFinal(observed: DispatchObservation, row: RunRowSnapshot): DispatchFinal {
  const selfReported = !!row && !!row.status && !NOT_SELF_REPORTED.has(row.status);
  if (selfReported) {
    const dispatcherSawNothingWrong = observed.status === 'success' || observed.status === 'dispatched';
    const agreeingNon2xx = !observed.responseOk
      && observed.httpStatus !== null
      && row!.http_status === observed.httpStatus;
    if (dispatcherSawNothingWrong || agreeingNon2xx) {
      return { status: row!.status!, httpStatus: row!.http_status, errorMsg: row!.error, keptSelfReport: true };
    }
  }
  return { status: observed.status, httpStatus: observed.httpStatus, errorMsg: observed.errorMsg, keptSelfReport: false };
}
