/**
 * BigQuery client for USASpending data.
 *
 * Auth model: in local dev, uses Application Default Credentials
 * (ADC) from `gcloud auth application-default login`. In Vercel,
 * uses a service account JSON parsed from GCP_SA_JSON env var
 * (paste the entire JSON blob).
 *
 * Cost model: BigQuery charges $6.25/TB scanned. Our tables are
 * partitioned by fiscal_year and clustered by recipient_uei +
 * recipient_name. A typical contractor query scans <100MB, costs
 * fractions of a cent. The cache wrapper (queryCached) sits in
 * front so we don't repeat the same query for every page view.
 */
import { BigQuery, type BigQueryOptions } from '@google-cloud/bigquery';

const PROJECT_ID = 'market-assasin';
const DATASET = 'usaspending';

let _client: BigQuery | null = null;

type BigQueryRetryError = Error & {
  code?: number;
  errors?: Array<{ reason?: string; message?: string }>;
};

/**
 * QueryUsagePerDay is a hard project-wide daily limit, not transient pressure.
 * Retrying it can only create more failed jobs and hide the original caller.
 */
export function isBigQueryQuotaExceeded(err: BigQueryRetryError): boolean {
  if (/QueryUsagePerDay|Custom quota exceeded|quotaExceeded/i.test(err.message || '')) {
    return true;
  }
  return (err.errors ?? []).some((item) =>
    item.reason === 'quotaExceeded'
    || /QueryUsagePerDay|Custom quota exceeded|quotaExceeded/i.test(item.message || ''),
  );
}

/**
 * Per-job maximumBytesBilled refusal is terminal. Retrying it re-issues the
 * same over-ceiling scan and can only add failed jobs.
 */
export function isBigQueryBytesBilledExceeded(err: BigQueryRetryError): boolean {
  if (/bytes billed|maximumBytesBilled|bytesBilledLimitExceeded/i.test(err.message || '')) {
    return true;
  }
  return (err.errors ?? []).some((item) =>
    item.reason === 'bytesBilledLimitExceeded'
    || /bytes billed|maximumBytesBilled/i.test(item.message || ''),
  );
}

/**
 * Mirrors @google-cloud/common's default retry predicate except that hard
 * quotaExceeded and maximumBytesBilled failures are terminal. Transient 429/5xx
 * and rate-limit responses retain the SDK's normal bounded retry behavior.
 */
export function shouldRetryBigQueryError(err: BigQueryRetryError): boolean {
  if (isBigQueryQuotaExceeded(err)) return false;
  if (isBigQueryBytesBilledExceeded(err)) return false;
  if ([408, 429, 500, 502, 503, 504].includes(Number(err.code))) return true;
  return (err.errors ?? []).some((item) =>
    item.reason === 'rateLimitExceeded'
    || item.reason === 'userRateLimitExceeded'
    || Boolean(item.reason?.includes('EAI_AGAIN')),
  );
}

function clientOptions(
  base: Pick<BigQueryOptions, 'projectId' | 'credentials'>,
): BigQueryOptions {
  return {
    ...base,
    retryOptions: {
      autoRetry: true,
      maxRetries: 3,
      retryableErrorFn: shouldRetryBigQueryError,
    },
  };
}

function parseSaJson(raw: string): Record<string, unknown> {
  // Accept three formats from env:
  //   1. Raw JSON (works when env doesn't mangle newlines)
  //   2. Base64-encoded JSON (safest for Vercel — no newline issues)
  //   3. JSON with escaped \n that need converting to real newlines
  //      (Vercel sometimes does this with multi-line PEM keys)
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    // Try direct first, fall back to \n unescape for the private_key field
    try {
      return JSON.parse(trimmed);
    } catch {
      // Vercel can double-escape \n inside private_key
      return JSON.parse(trimmed.replace(/\\n/g, '\n'));
    }
  }
  // Assume base64
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

// Returns the client_email of the service account the BQ client is
// authenticating with — parsed the same way getClient() parses it.
// For diagnosing which principal needs dataset write access.
export function getServiceAccountEmail(): string {
  const raw = process.env.GCP_SA_JSON;
  if (!raw) return 'ADC (no GCP_SA_JSON)';
  try {
    return (parseSaJson(raw) as { client_email?: string }).client_email || 'no client_email in SA';
  } catch (e) {
    return `parse failed: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

function getClient(): BigQuery {
  if (_client) return _client;

  const saJson = process.env.GCP_SA_JSON;
  if (saJson) {
    // Vercel / production: service account from env. Tolerates raw JSON,
    // base64 JSON, or JSON with escaped \n in private_key.
    const credentials = parseSaJson(saJson) as { project_id?: string };
    _client = new BigQuery(clientOptions({
      projectId: credentials.project_id ?? PROJECT_ID,
      credentials: credentials as never,
    }));
  } else {
    // Local dev: Application Default Credentials
    _client = new BigQuery(clientOptions({ projectId: PROJECT_ID }));
  }
  return _client;
}

export const BQ_DATASET = `\`${PROJECT_ID}.${DATASET}\``;
export const BQ_TABLES = {
  awards: `\`${PROJECT_ID}.${DATASET}.awards\``,
  recipients: `\`${PROJECT_ID}.${DATASET}.recipients\``,
  // Contractor SEO pages read recipients_rollup_merged: one row per company,
  // built in build-derived.sql by (1) rolling per-UEI awards up to parent_uei,
  // then (2) collapsing same-normalized-name parent rollups (LOCKHEED MARTIN
  // CORP + CORPORATION → one). Column-compatible with the intermediate
  // recipients_rollup; carries child_ueis[] (the company's whole UEI set) for
  // filtering awards. This makes each prime ONE canonical page with its full
  // footprint instead of several scattered/duplicate pages.
  recipientsRollup: `\`${PROJECT_ID}.${DATASET}.recipients_rollup_merged\``,
  recipientExecutives: `\`${PROJECT_ID}.${DATASET}.recipient_executives\``,
  naicsSummary: `\`${PROJECT_ID}.${DATASET}.naics_summary\``,
  agencySummary: `\`${PROJECT_ID}.${DATASET}.agency_summary\``,
  // Pre-aggregated agency breakdowns (built monthly by
  // scripts/bq-build-agency-rollups.sql) so per-agency recipient/NAICS
  // queries read ~MB instead of scanning the full awards table. The big
  // BQ-quota saver.
  agencyTopRecipients: `\`${PROJECT_ID}.${DATASET}.agency_top_recipients\``,
  agencyTopNaics: `\`${PROJECT_ID}.${DATASET}.agency_top_naics\``,
  // Agency → contracting-office summary (Decision Makers office drill-down).
  // SAM POC data has no office; awards.awarding_office does — pre-aggregated
  // here (top 100 offices/agency by spend). Monthly build, ~MB reads.
  agencyOfficeSummary: `\`${PROJECT_ID}.${DATASET}.agency_office_summary\``,
  // Unified rollup for the /top/[slug] listicle pages (top contractors by
  // agency / naics / sub_agency / state / set_aside). Same monthly build.
  topContractorsByDimension: `\`${PROJECT_ID}.${DATASET}.top_contractors_by_dimension\``,
  // Clustered lookups (built in build-derived.sql) that replace full-table
  // scans on /contracts/[piid] and /awards/[id]. awards is clustered on
  // (recipient_uei, recipient_name), so lookups by piid / award_id scanned
  // the whole 63M-row table — these clustered-by-key tables scan ~MB instead.
  piidLookup: `\`${PROJECT_ID}.${DATASET}.piid_lookup\``,
  awardDetailLookup: `\`${PROJECT_ID}.${DATASET}.award_detail_lookup\``,
} as const;

export interface BqQueryParams {
  query: string;
  params?: Record<string, unknown>;
  /** BigQuery job labels. Prefer bqJobOptions() so all three dimensions exist. */
  labels?: Record<string, string>;
  // Maximum bytes the query is allowed to process. Hard ceiling
  // to prevent runaway costs from a bad WHERE clause.
  maximumBytesBilled?: string;
  /**
   * Opt a KNOWN-heavy job out of the runtime ceiling — the weekly ingest and the monthly
   * rollup rebuilds legitimately scan the whole table (measured: one full ingest ≈ 275 GB).
   * Must be passed EXPLICITLY and named, so a full-table scan is always a deliberate act by
   * a batch job rather than something a request path can do by accident.
   */
  bulkJob?: string;
}

/**
 * The runtime ceiling for an ordinary app query.
 *
 * MEASURED 2026-08-15 (dry runs are free, and work even while the daily quota is exhausted):
 *   contractor page, awards by UEI (clustered)  0.00 GiB
 *   naics/agency summary reads                  0.00 GiB
 *   related-contractors aggregate               4.48 GiB   ← the real heavy legitimate case
 *   SELECT * on awards                         41.06 GiB   ← the runaway shape
 *
 * Note the code comment here previously described the heavy case as "~3GB"; it is actually
 * 4.48 GiB, which is why the ceiling stays at 5 GiB rather than being tightened. Lowering it
 * to 2 GiB — my first instinct — would have broken a real feature to fix a problem it does
 * not cause.
 *
 * WHY THIS MATTERS BEYOND COST: the project carries a custom QueryUsagePerDay override
 * (mutable GCP configuration, far below the 200 TiB default — do not hardcode the live
 * ceiling here). When that daily quota is exhausted, EVERY query in the project fails
 * instantly at 0 bytes billed — including the awards-freshness oracle — so one runaway
 * scan does not just cost money, it BLINDS the guards for the rest of the day and
 * destroys the evidence of what ran away (all subsequent jobs log 0 bytes). This ceiling
 * makes that shape fail on its own, naming itself, instead of taking the project down
 * with it.
 */
const RUNTIME_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** What a deliberate bulk job may scan (one full ingest ≈ 275 GB across its statements). */
const BULK_MAX_BYTES = 200 * 1024 * 1024 * 1024;

export interface BqJobOptionInput {
  feature: string;
  tool: string;
  queryFamily: string;
  maximumBytesBilled?: string | number;
}

function labelPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 63);
  return normalized || fallback;
}

/** Build consistent, valid labels for cost attribution in JOBS_BY_PROJECT. */
export function bqJobOptions(input: BqJobOptionInput): Pick<
  BqQueryParams,
  'labels' | 'maximumBytesBilled'
> {
  return {
    labels: {
      feature: labelPart(input.feature, 'unknown'),
      tool: labelPart(input.tool, 'unknown'),
      query_family: labelPart(input.queryFamily, 'unknown'),
    },
    ...(input.maximumBytesBilled === undefined
      ? {}
      : { maximumBytesBilled: String(input.maximumBytesBilled) }),
  };
}

const DEFAULT_LABELS = bqJobOptions({
  feature: 'legacy',
  tool: 'unclassified',
  queryFamily: 'unclassified',
}).labels!;

/**
 * This exact predicate consumed 1.55 TiB in 416 calls on 2026-09-05. The
 * function-wrapped COALESCE prevents recipient_uei cluster pruning, so even
 * one family scans 3.807 GiB. Family expansion must read
 * recipients_rollup_merged.child_ueis instead.
 */
const UNSAFE_FAMILY_SCAN =
  /COALESCE\s*\(\s*(?:[a-z_][\w]*\.)?parent_uei\s*,\s*(?:[a-z_][\w]*\.)?recipient_uei\s*\)\s*=\s*@[a-z_][\w]*/i;

export function assertSafeBigQueryShape(query: string): void {
  if (UNSAFE_FAMILY_SCAN.test(query)) {
    throw new Error(
      'Unsafe corporate-family scan blocked: use recipients_rollup_merged.child_ueis, '
      + 'never COALESCE(parent_uei, recipient_uei) equality on awards',
    );
  }
}

export async function bqQuery<T = Record<string, unknown>>(opts: BqQueryParams): Promise<T[]> {
  assertSafeBigQueryShape(opts.query);
  const client = getClient();
  const [rows] = await client.query({
    query: opts.query,
    params: opts.params,
    location: 'US',
    labels: { ...DEFAULT_LABELS, ...opts.labels },
    // An explicit cap ALWAYS wins; otherwise a named bulk job gets the batch ceiling and
    // everything else gets the runtime ceiling. See RUNTIME_MAX_BYTES for the measurements.
    maximumBytesBilled: opts.maximumBytesBilled
      ?? String(opts.bulkJob ? BULK_MAX_BYTES : RUNTIME_MAX_BYTES),
  });
  return rows as T[];
}
