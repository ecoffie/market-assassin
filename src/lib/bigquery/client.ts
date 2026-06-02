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
import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = 'market-assasin';
const DATASET = 'usaspending';

let _client: BigQuery | null = null;

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
    _client = new BigQuery({
      projectId: credentials.project_id ?? PROJECT_ID,
      credentials: credentials as never,
    });
  } else {
    // Local dev: Application Default Credentials
    _client = new BigQuery({ projectId: PROJECT_ID });
  }
  return _client;
}

export const BQ_DATASET = `\`${PROJECT_ID}.${DATASET}\``;
export const BQ_TABLES = {
  awards: `\`${PROJECT_ID}.${DATASET}.awards\``,
  recipients: `\`${PROJECT_ID}.${DATASET}.recipients\``,
  recipientExecutives: `\`${PROJECT_ID}.${DATASET}.recipient_executives\``,
  naicsSummary: `\`${PROJECT_ID}.${DATASET}.naics_summary\``,
  agencySummary: `\`${PROJECT_ID}.${DATASET}.agency_summary\``,
  // Pre-aggregated agency breakdowns (built monthly by
  // scripts/bq-build-agency-rollups.sql) so per-agency recipient/NAICS
  // queries read ~MB instead of scanning the full awards table. The big
  // BQ-quota saver.
  agencyTopRecipients: `\`${PROJECT_ID}.${DATASET}.agency_top_recipients\``,
  agencyTopNaics: `\`${PROJECT_ID}.${DATASET}.agency_top_naics\``,
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
  // Maximum bytes the query is allowed to process. Hard ceiling
  // to prevent runaway costs from a bad WHERE clause.
  maximumBytesBilled?: string;
}

export async function bqQuery<T = Record<string, unknown>>(opts: BqQueryParams): Promise<T[]> {
  const client = getClient();
  const [rows] = await client.query({
    query: opts.query,
    params: opts.params,
    location: 'US',
    // 5GB default — most contractor queries scan <500MB but related-
    // contractor lookups across the full 63M-row awards table can hit
    // 3GB. Hard cap keeps runaway $ off the table; the 5GB ceiling is
    // ~$0.03 per query worst case.
    maximumBytesBilled: opts.maximumBytesBilled ?? String(5 * 1024 * 1024 * 1024),
  });
  return rows as T[];
}
