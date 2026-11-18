/**
 * DoD SBIR sync outcome honesty.
 *
 * Measured 2026-11-18: sync-dod-sbir returned HTTP 200 + success every 6h while
 * dod_sbir_topics held 0 rows (api-down path treated "source quiet" as success).
 * Job success is not data advancement — an empty or unreachable run must not
 * look green.
 */

export type DodSbirStop = 'budget' | 'last-page' | 'rate-limit' | 'error' | 'api-down';

export type DodSbirOutcome = {
  success: boolean;
  httpStatus: number;
  cronOutcome: 'success' | 'error' | 'partial';
  disclosure: string;
};

/**
 * Decide whether an execute run may claim success.
 *
 * `heldRows` is the corpus size after the run (0 when never drained). An
 * api-down or empty corpus is never success — the dispatcher and cron_jobs
 * last_status must show the failure, not manufacture health.
 */
export function decideDodSbirExecuteOutcome(input: {
  stopped: DodSbirStop;
  upserted: number;
  heldRows: number;
}): DodSbirOutcome {
  if (input.stopped === 'api-down') {
    return {
      success: false,
      httpStatus: 503,
      cronOutcome: 'error',
      disclosure:
        input.heldRows === 0
          ? 'sbir.gov unreachable; dod_sbir_topics empty — not a successful sync'
          : 'sbir.gov unreachable; held rows unchanged — not a successful sync',
    };
  }
  if (input.stopped === 'error') {
    return {
      success: false,
      httpStatus: 502,
      cronOutcome: 'error',
      disclosure: 'fetch or upsert error — not a successful sync',
    };
  }
  if (input.stopped === 'rate-limit') {
    return {
      success: false,
      httpStatus: 429,
      cronOutcome: 'partial',
      disclosure: 'rate-limited before drain completed',
    };
  }
  // last-page / budget with nothing held: the drain "finished" into an empty table.
  if (input.upserted === 0 && input.heldRows <= 0) {
    return {
      success: false,
      httpStatus: 503,
      cronOutcome: 'error',
      disclosure: 'drain completed with 0 topics held — empty corpus is not success',
    };
  }
  return {
    success: true,
    httpStatus: 200,
    cronOutcome: 'success',
    disclosure: '',
  };
}
