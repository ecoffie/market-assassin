/**
 * DoD SBIR sync outcome honesty + controlled recovery.
 *
 * Measured 2026-11-18: sync-dod-sbir returned HTTP 200 + success every 6h while
 * dod_sbir_topics held 0 rows (api-down path treated "source quiet" as success).
 * Job success is not data advancement — an empty or unreachable run must not
 * look green.
 *
 * Eric 2026-11-18: do NOT park the cron. Temporary unavailability → in-run retries,
 * then honest HTTP 503; the next dispatcher tick recovers when sbir.gov is back.
 */

export type DodSbirStop = 'budget' | 'last-page' | 'rate-limit' | 'error' | 'api-down';

export type DodSbirOutcome = {
  success: boolean;
  httpStatus: number;
  cronOutcome: 'success' | 'error' | 'partial';
  disclosure: string;
};

/** Default probe retries when sbir.gov flaps (maintenance / rate-limit). */
export const DOD_SBIR_PROBE_ATTEMPTS = 3;
export const DOD_SBIR_PROBE_DELAY_MS = 5_000;

export type DodSbirProbePage = {
  rateLimited: boolean;
  degraded: boolean;
};

/**
 * Probe with bounded retries. A single transient failure must not permanently
 * disable the job — keep the cron enabled and recover on a later attempt/tick.
 */
export async function probeDodSbirWithRetries<T extends DodSbirProbePage>(
  fetchPage: () => Promise<T>,
  opts: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ page: T; attemptsUsed: number }> {
  const attempts = Math.max(1, opts.attempts ?? DOD_SBIR_PROBE_ATTEMPTS);
  const delayMs = Math.max(0, opts.delayMs ?? DOD_SBIR_PROBE_DELAY_MS);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let page = await fetchPage();
  let used = 1;
  while (used < attempts && (page.rateLimited || page.degraded)) {
    await sleep(delayMs);
    page = await fetchPage();
    used += 1;
  }
  return { page, attemptsUsed: used };
}

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
