/**
 * Dry-run the assess_market_depth activity EXISTS join against the SAME real
 * 541512 UEIs before claiming a cost reduction. Dry-runs are free and do not
 * count against QueryUsagePerDay.
 *
 *   npx tsx -r dotenv/config scripts/mrr-activity-dry-run-cost.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BigQuery } from '@google-cloud/bigquery';
import { BQ_TABLES } from '../src/lib/bigquery/client';
import {
  ACTIVITY_MAX_BYTES,
  REAL_541512_ACTIVITY_UEIS,
  REAL_541512_PARENT_BATCH_UEIS,
} from '../src/lib/gov-buyer/evaluation-bound';

const client = new BigQuery({ projectId: 'market-assasin' });

const ACTIVITY_SQL = `
  SELECT
    r.recipient_uei,
    r.total_obligated,
    r.award_count,
    r.distinct_agency_count,
    CAST(r.last_action_date AS STRING) AS last_action_date,
    EXISTS (
      SELECT 1 FROM ${BQ_TABLES.awards} a
      WHERE a.recipient_uei = r.recipient_uei
        AND a.naics_code = @naics
    ) AS won_target_naics
  FROM ${BQ_TABLES.recipients} r
  WHERE r.recipient_uei IN UNNEST(@ueis)
`;

async function dryRun(ueis: string[]): Promise<number> {
  const [job] = await client.createQueryJob({
    query: ACTIVITY_SQL,
    params: { ueis, naics: '541512' },
    location: 'US',
    dryRun: true,
    labels: {
      feature: 'mrr',
      tool: 'assess_market_depth',
      query_family: 'market-depth-activity',
    },
    maximumBytesBilled: String(ACTIVITY_MAX_BYTES),
  });
  const bytes = Number(job.metadata?.statistics?.totalBytesProcessed ?? 0);
  return bytes;
}

async function main() {
  const ten = [...REAL_541512_ACTIVITY_UEIS];
  const fifty = [...REAL_541512_PARENT_BATCH_UEIS];
  const tenBytes = await dryRun(ten);
  const fiftyBytes = await dryRun(fifty);
  const proof = {
    generatedAt: new Date().toISOString(),
    queryFamily: 'market-depth-activity',
    queryShape: 'EXISTS awards.recipient_uei = recipients.recipient_uei AND naics_code = @naics',
    n10: {
      ueiCount: ten.length,
      ueis: ten,
      totalBytesProcessed: tenBytes,
      gib: Number((tenBytes / (1024 ** 3)).toFixed(6)),
    },
    n50: {
      ueiCount: fifty.length,
      ueis: fifty,
      totalBytesProcessed: fiftyBytes,
      gib: Number((fiftyBytes / (1024 ** 3)).toFixed(6)),
    },
    declaredCapBytes: ACTIVITY_MAX_BYTES,
    underCap: tenBytes < ACTIVITY_MAX_BYTES && fiftyBytes < ACTIVITY_MAX_BYTES,
    note:
      'Activity EXISTS keeps the 1 GiB ceiling. n=50 uses the same real UEIs as the parent-edge batch dry-run. Synthetic UEIs are invalid because clustering prunes empty blocks.',
  };
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.underCap) {
    throw new Error(
      `activity dry-run exceeds 1 GiB cap (n10=${proof.n10.gib} GiB n50=${proof.n50.gib} GiB)`,
    );
  }
  mkdirSync('out/mrr-ralph-demo', { recursive: true });
  writeFileSync(
    join('out/mrr-ralph-demo', 'activity-dry-run-after.json'),
    JSON.stringify(proof, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
