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
 *   2. Vitest is running (any config). No variable re-enables app-code BigQuery under Vitest;
 *      in particular having Google credentials, or RUN_LIVE_BQ_TESTS=1, does not. Background: a
 *      test that switched on whenever GOOGLE_APPLICATION_CREDENTIALS was set wrote two load
 *      jobs into a production dataset.
 *   3. BQ_DISABLED === '1' (operator kill switch).
 *
 * Runtime request handling and operator scripts are unaffected.
 *
 * Live BigQuery integration tests are *.bq-integration.test.ts files, excluded from the unit
 * suite and run only by `npm run test:bq-integration` (its own Vitest process). That process
 * needs RUN_LIVE_BQ_TESTS=1 AND an approved disposable target (BQ_TEST_PROJECT +
 * BQ_TEST_DATASET), and even then only `bq` commands confined to that dataset are admitted
 * (authorizeBqCommand). Production datasets are refused by name even if approved.
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
  // Under Vitest, app code NEVER reaches BigQuery, with no environment escape. RUN_LIVE_BQ_TESTS
  // does not change this: the live integration test runs in its own Vitest process
  // (vitest.bq-integration.config.ts) and uses the `bq` CLI through a narrow authorizer that only
  // admits commands targeting the approved disposable dataset (src/test/bq-integration.setup.ts).
  if (env.VITEST) return 'app code never calls BigQuery under Vitest (unit or integration process)';
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

// ── Narrow `bq` CLI authorization (integration process only) ──────────────────

export type BqAuthorization = { ok: true } | { ok: false; reason: string };

const SAFE_IDENT = /^[A-Za-z0-9_]+$/;
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|EXPORT|CALL|EXECUTE|DECLARE|SET|BEGIN|LOAD)\b/i;
const FORBIDDEN_QUERY_FLAGS = /^--(destination_table|replace|append_table|use_legacy_sql(?!=false)|batch|dry_run=false)\b/;

/** `dataset.table` or `project:dataset.table`, confined to the target. */
function tableRefInTarget(ref: string, target: DisposableBqTarget): boolean {
  const m = ref.match(/^(?:([A-Za-z0-9-]+):)?([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
  if (!m) return false;
  const [, project, dataset, table] = m;
  return (project === undefined || project === target.project) && dataset === target.dataset && SAFE_IDENT.test(table);
}

/**
 * Decide whether ONE `bq` CLI invocation may run in the integration process. It is admitted only
 * when it is provably confined to the approved disposable dataset:
 *   - `--project_id=<approved project>` exactly once, as the first argument
 *   - subcommand is load | query | show | rm | version
 *   - load/show/rm: exactly one table reference, inside the approved dataset
 *     (rm requires -t; dataset removal flags -r/-d are refused)
 *   - query: exactly one read-only SELECT with no statement separators or DML/DDL, every table
 *     reference is backtick-quoted `project.dataset.table` inside the target, and no flag that
 *     writes results (--destination_table, --replace, --append_table)
 * Anything else, including any unrecognised shape, is refused.
 */
export function authorizeBqCommand(args: string[], target: DisposableBqTarget): BqAuthorization {
  if (args.length === 1 && args[0] === 'version') return { ok: true };
  if (args[0] !== `--project_id=${target.project}`) return { ok: false, reason: `first argument must be --project_id=${target.project}` };
  if (args.slice(1).some((a) => /^--(project_id|dataset_id|location)=/.test(a))) return { ok: false, reason: 'project/dataset/location may be set only once' };
  const [sub, ...rest] = args.slice(1);
  const positional = rest.filter((a) => !a.startsWith('-'));
  const flags = rest.filter((a) => a.startsWith('-'));

  switch (sub) {
    case 'load': {
      if (positional.length !== 3) return { ok: false, reason: 'load needs exactly: <table> <source> <schema>' };
      if (!tableRefInTarget(positional[0], target)) return { ok: false, reason: `load destination ${positional[0]} is outside ${target.project}:${target.dataset}` };
      return { ok: true };
    }
    case 'show':
    case 'rm': {
      if (sub === 'rm' && (!flags.includes('-t') || flags.some((f) => f === '-r' || f === '-d'))) return { ok: false, reason: 'rm must be a single-table removal (-t), never -r/-d' };
      if (positional.length !== 1 || !tableRefInTarget(positional[0], target)) return { ok: false, reason: `${sub} target must be one table in ${target.project}:${target.dataset}` };
      return { ok: true };
    }
    case 'query': {
      if (positional.length !== 1) return { ok: false, reason: 'query needs exactly one SQL argument' };
      if (flags.some((f) => FORBIDDEN_QUERY_FLAGS.test(f))) return { ok: false, reason: 'query may not write results (destination/replace/append/legacy/batch)' };
      const sql = positional[0].trim();
      if (!/^SELECT\b/i.test(sql) || sql.includes(';') || FORBIDDEN_SQL.test(sql)) return { ok: false, reason: 'query must be a single read-only SELECT' };
      const refs = [...sql.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (!refs.length) return { ok: false, reason: 'query must reference its tables as `project.dataset.table`' };
      for (const ref of refs) {
        const parts = ref.split('.');
        if (parts.length !== 3 || parts[0] !== target.project || parts[1] !== target.dataset || !SAFE_IDENT.test(parts[2])) {
          return { ok: false, reason: `query references ${ref}, outside ${target.project}.${target.dataset}` };
        }
      }
      // Any FROM/JOIN must be followed by a backtick-quoted reference (no unqualified tables).
      if (/\b(FROM|JOIN)\s+(?!`)/i.test(sql)) return { ok: false, reason: 'every FROM/JOIN must name a backtick-quoted table' };
      return { ok: true };
    }
    default:
      return { ok: false, reason: `bq ${sub ?? '(none)'} is not an allowed integration-test command` };
  }
}
