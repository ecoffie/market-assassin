/**
 * Live BigQuery execution guard. Fail closed.
 *
 * Every path from app code to BigQuery calls assertLiveBigQueryAllowed() BEFORE it
 * reads credentials or opens a connection:
 *   - src/lib/bigquery/client.ts getClient()      (all bqQuery / cache callers)
 *   - src/lib/analytics/platform-health.ts        (its own BigQuery client)
 *   - src/app/api/app/relationships/route.ts      (raw REST call)
 *
 * Live BigQuery is BLOCKED when:
 *   1. `next build` is running (NEXT_PHASE=phase-production-build, or MINDY_BUILD=1 from
 *      the build script). Builds are cache-only: a KV miss renders the page's empty/
 *      unavailable path, and ISR fills it at runtime. Background: on 2026-09-29 a local
 *      build with no KV ran 64 live queries from the /top/* prerenders.
 *   2. The unit suite is running (VITEST) and RUN_LIVE_BQ_TESTS !== '1'. Merely having
 *      Google credentials on the machine never enables live BigQuery. Background: a test
 *      that switched on whenever GOOGLE_APPLICATION_CREDENTIALS was set wrote two load
 *      jobs into a production dataset.
 *   3. BQ_DISABLED === '1' (operator kill switch).
 *
 * Runtime request handling and operator scripts are unaffected.
 *
 * Integration tests that genuinely need BigQuery must opt in with RUN_LIVE_BQ_TESTS=1
 * AND name an approved disposable target (BQ_TEST_PROJECT + BQ_TEST_DATASET). Production
 * datasets are refused by name even if someone adds them to the approved list.
 */

export class LiveBigQueryBlockedError extends Error {
  readonly code = 'LIVE_BQ_BLOCKED';
  constructor(readonly operation: string, readonly reason: string) {
    super(`Live BigQuery blocked (${operation}): ${reason}`);
    this.name = 'LiveBigQueryBlockedError';
  }
}

type Env = Record<string, string | undefined>;

export function liveBigQueryBlockReason(env: Env = process.env): string | null {
  if (env.NEXT_PHASE === 'phase-production-build' || env.MINDY_BUILD === '1') {
    return 'next build is cache-only; live BigQuery is never called during a build';
  }
  if (env.BQ_DISABLED === '1') return 'BQ_DISABLED=1';
  if (env.VITEST && env.RUN_LIVE_BQ_TESTS !== '1') {
    return 'unit tests never call BigQuery (integration tests need RUN_LIVE_BQ_TESTS=1 and an approved disposable dataset)';
  }
  return null;
}

// One log line per operation per process, so a blocked build is visible without flooding.
const logged = new Set<string>();
let blockedCount = 0;

export function blockedLiveBigQueryCount(): number {
  return blockedCount;
}

export function assertLiveBigQueryAllowed(operation: string, env: Env = process.env): void {
  const reason = liveBigQueryBlockReason(env);
  if (!reason) return;
  blockedCount++;
  if (!logged.has(operation)) {
    logged.add(operation);
    console.warn(`[bq-guard] blocked ${operation}: ${reason}`);
  }
  throw new LiveBigQueryBlockedError(operation, reason);
}

export function isLiveBigQueryBlocked(err: unknown): err is LiveBigQueryBlockedError {
  return err instanceof LiveBigQueryBlockedError || (err as { code?: string } | null)?.code === 'LIVE_BQ_BLOCKED';
}

// ── Integration tests ─────────────────────────────────────────────────────────

/**
 * Disposable datasets that live integration tests may write to. A dataset is added here
 * only after it exists with a short default table expiration (1 day) and holds nothing
 * anything else reads. Empty until one is provisioned.
 */
export const APPROVED_DISPOSABLE_BQ_TARGETS: ReadonlyArray<{ project: string; dataset: string }> = [];

// A disposable dataset must be named as one, AND be on the approved list. `usaspending` is
// the known production dataset (the 2026-09-29 incident target) and is refused by name.
const DISPOSABLE_DATASET_PREFIX = /^(ci|test|tmp)_[a-z0-9_]+$/i;
const KNOWN_PRODUCTION_DATASETS = new Set(['usaspending']);

export interface DisposableBqTarget {
  project: string;
  dataset: string;
}

/**
 * The target for a live BigQuery integration test, or null when the test must skip.
 * Throws when RUN_LIVE_BQ_TESTS=1 is set but the target is not an approved disposable
 * dataset, so a misconfigured opt-in fails loudly instead of skipping silently.
 */
export function resolveDisposableBqTestTarget(
  env: Env = process.env,
  approved: ReadonlyArray<DisposableBqTarget> = APPROVED_DISPOSABLE_BQ_TARGETS,
): DisposableBqTarget | null {
  if (env.RUN_LIVE_BQ_TESTS !== '1') return null;
  const project = env.BQ_TEST_PROJECT ?? '';
  const dataset = env.BQ_TEST_DATASET ?? '';
  if (!project || !dataset) {
    throw new Error('RUN_LIVE_BQ_TESTS=1 requires BQ_TEST_PROJECT and BQ_TEST_DATASET');
  }
  if (KNOWN_PRODUCTION_DATASETS.has(dataset.toLowerCase())) {
    throw new Error(`Refusing live BigQuery test against production dataset ${project}.${dataset}`);
  }
  if (!DISPOSABLE_DATASET_PREFIX.test(dataset)) {
    throw new Error(`Refusing live BigQuery test: dataset ${dataset} is not named as disposable (ci_/test_/tmp_)`);
  }
  if (!approved.some((t) => t.project === project && t.dataset === dataset)) {
    throw new Error(`${project}.${dataset} is not an approved disposable BigQuery test dataset (see APPROVED_DISPOSABLE_BQ_TARGETS)`);
  }
  return { project, dataset };
}

/** A table name no other run can collide with: prefix_<utc stamp>_<random>. */
export function uniqueTestTableName(prefix: string, now: Date = new Date(), random: () => number = Math.random): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix.replace(/[^a-zA-Z0-9_]/g, '_')}_${stamp}_${suffix}`;
}
