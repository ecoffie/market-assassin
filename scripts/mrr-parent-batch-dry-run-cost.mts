/**
 * Dry-run the bounded parent-edge BATCH against the same 50 real 541512 UEIs.
 * Dry-runs are free and do not count against QueryUsagePerDay.
 *
 * This records billed-bytes of the awards IN UNNEST scan under the 2 GiB
 * demo safety ceiling. It is bounded cost containment, not proof the parent
 * query has been fully optimized.
 *
 *   npx tsx -r dotenv/config scripts/mrr-parent-batch-dry-run-cost.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BigQuery } from '@google-cloud/bigquery';
import { BQ_TABLES } from '../src/lib/bigquery/client';
import { REAL_541512_PARENT_BATCH_UEIS } from '../src/lib/gov-buyer/evaluation-bound';
import {
  PARENT_EDGE_BATCH_MAX_BYTES,
  PARENT_EDGE_BATCH_MAX_UEIS,
  uniqueWellFormedUeis,
} from '../src/lib/mrr/corporate-family';

const client = new BigQuery({ projectId: 'market-assasin' });

const PARENT_BATCH_SQL = `
  SELECT
    recipient_uei,
    parent_uei,
    ANY_VALUE(parent_name) AS parent_name,
    COUNT(*) AS award_count,
    CAST(MAX(action_date) AS STRING) AS as_of
  FROM ${BQ_TABLES.awards}
  WHERE recipient_uei IN UNNEST(@ueis)
    AND parent_uei IS NOT NULL
    AND parent_uei != ''
  GROUP BY recipient_uei, parent_uei
`;

async function dryRun(ueis: string[]): Promise<number> {
  const [job] = await client.createQueryJob({
    query: PARENT_BATCH_SQL,
    params: { ueis },
    location: 'US',
    dryRun: true,
    labels: {
      feature: 'mrr',
      tool: 'corporate-family',
      query_family: 'parent-edge-batch',
    },
    maximumBytesBilled: String(PARENT_EDGE_BATCH_MAX_BYTES),
  });
  return Number(job.metadata?.statistics?.totalBytesProcessed ?? 0);
}

async function main() {
  const ueis = uniqueWellFormedUeis([...REAL_541512_PARENT_BATCH_UEIS]);
  if (ueis.length !== PARENT_EDGE_BATCH_MAX_UEIS) {
    throw new Error(
      `parent dry-run expected ${PARENT_EDGE_BATCH_MAX_UEIS} unique UEIs, got ${ueis.length}`,
    );
  }
  const bytes = await dryRun(ueis);
  const gib = bytes / (1024 ** 3);
  const proof = {
    generatedAt: new Date().toISOString(),
    queryFamily: 'parent-edge-batch',
    queryShape: 'recipient_uei IN UNNEST(@ueis) GROUP BY recipient_uei, parent_uei',
    ueiCount: ueis.length,
    ueis,
    totalBytesProcessed: bytes,
    gib: Number(gib.toFixed(6)),
    declaredCapBytes: PARENT_EDGE_BATCH_MAX_BYTES,
    underCap: bytes < PARENT_EDGE_BATCH_MAX_BYTES,
    note:
      '2 GiB is bounded cost containment for the demo parent-edge batch (≤50 unique UEIs, one query, per-run cache, no retry after quotaExceeded or maximumBytesBilled). It is not proof the awards scan is optimized. Follow-up: clustered/rollup parent-edge source.',
  };
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.underCap) {
    throw new Error(`parent-edge dry-run ${gib.toFixed(3)} GiB exceeds 2 GiB cap`);
  }
  mkdirSync('out/mrr-ralph-demo', { recursive: true });
  writeFileSync(
    join('out/mrr-ralph-demo', 'parent-batch-dry-run.json'),
    JSON.stringify(proof, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
