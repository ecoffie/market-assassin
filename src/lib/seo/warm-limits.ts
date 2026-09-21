/**
 * Hard limits for the contractor SEO warm job.
 *
 * WHY THESE EXIST
 * ---------------
 * The crawler-facing cold-scan path exhausted the BigQuery `QueryUsagePerDay`
 * custom quota and took the AUTHENTICATED Contractors panel down with it — the
 * product and the SEO surface share one GCP project quota. Once that quota is
 * gone every query in the project fails instantly at 0 bytes billed, including
 * the awards-freshness oracle, so the guards go blind at the same moment.
 *
 * `ENABLE_SEO_LIVE_BQ` stopped Googlebot from causing that. These limits stop
 * *us* from causing it: a warmer that can scan without a ceiling is the same
 * outage with a friendlier trigger.
 *
 * THE PRIORITY ORDER IS NOT NEGOTIABLE
 * ------------------------------------
 * The authenticated product's BigQuery capacity ranks above SEO coverage.
 * Warming must stop before it can threaten product queries. Every limit below
 * fails CLOSED: on doubt the warmer stops early and reports partial coverage,
 * because a partial warm is recoverable on the next run and a drained quota is
 * a day-long product outage.
 *
 * `maxBytesPerScan` is also passed to BigQuery as `maximumBytesBilled`, so the
 * ceiling is enforced by BigQuery itself rather than by our arithmetic — a
 * query that would exceed it is refused at 0 bytes billed instead of running.
 */
export const CONTRACTOR_WARM_LIMITS = {
  /** Slugs per batched scan. Sized from a dry run, not guessed. */
  slugsPerScan: 2000,

  /** Records (slugs) a single run may warm, however many batches that takes. */
  maxRecordsPerRun: 5000,

  /**
   * Hard `maximumBytesBilled` on every scan the warmer issues. BigQuery refuses
   * the job rather than overrunning it. Well under the 5 GiB RUNTIME_MAX_BYTES
   * default so a warm can never be the biggest thing in the project.
   */
  maxBytesPerScan: 2 * 1024 ** 3,

  /** Total bytes one run may scan across all its batches. */
  maxBytesPerRun: 8 * 1024 ** 3,

  /** Total bytes the warmer may scan per calendar day, across all runs. */
  dailyScanBudgetBytes: 16 * 1024 ** 3,

  /** Wall-clock ceiling for one run. Stops a slow run from overlapping the next. */
  maxRuntimeMs: 10 * 60 * 1000,

  /** Concurrent KV writes. Not a BigQuery limit — just avoids hammering KV. */
  kvWriteConcurrency: 24,

  /** Retries per scan. Low on purpose: a retry re-issues the scan and re-bills it. */
  maxRetriesPerScan: 1,
} as const;

/** KV key holding the rolling daily scan total, so the budget survives restarts. */
export function dailyBudgetKey(day = new Date().toISOString().slice(0, 10)): string {
  return `seo:warm:bytes-scanned:${day}`;
}
