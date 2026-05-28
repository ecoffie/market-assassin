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

function getClient(): BigQuery {
  if (_client) return _client;

  const saJson = process.env.GCP_SA_JSON;
  if (saJson) {
    // Vercel / production: service account from env
    const credentials = JSON.parse(saJson);
    _client = new BigQuery({
      projectId: credentials.project_id ?? PROJECT_ID,
      credentials,
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
