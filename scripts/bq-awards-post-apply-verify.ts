/**
 * Capture or verify sanitized post-apply state for bq-awards-ingest apply_incremental.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/bq-awards-post-apply-verify.ts capture
 *   ./node_modules/.bin/tsx scripts/bq-awards-post-apply-verify.ts verify
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  captureSanitizedSnapshot,
  formatVerificationReport,
  INGEST_BASELINE_PATH,
  verifyPostApply,
  type AwardsIngestSanitizedSnapshot,
} from '../src/lib/awards-ingest/post-apply-verify';

config({ path: '.env.local' });

function readBaseline(path: string): AwardsIngestSanitizedSnapshot {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as AwardsIngestSanitizedSnapshot;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'capture') {
    const snapshot = await captureSanitizedSnapshot();
    writeFileSync(INGEST_BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`post_apply_baseline: wrote ${INGEST_BASELINE_PATH}`);
    console.log(`awards_max_action_date=${snapshot.awardsMaxActionDate}`);
    console.log(`awards_row_count=${snapshot.awardsRowCount}`);
    console.log(`recipients_max_last_action_date=${snapshot.recipientsMaxLastActionDate}`);
    console.log(`recipients_rollup_merged_max_last_action_date=${snapshot.recipientsRollupMergedMaxLastActionDate}`);
    console.log(`data_sources_last_built=${snapshot.dataSourcesLastBuilt}`);
    console.log(`has_v1_clock_block=${snapshot.hasV1ClockBlock}`);
    return;
  }

  if (command === 'verify') {
    const baseline = readBaseline(INGEST_BASELINE_PATH);
    const current = await captureSanitizedSnapshot();
    const result = verifyPostApply(baseline, current);
    console.log(formatVerificationReport(result));
    if (!result.ok) process.exit(1);
    return;
  }

  console.error('usage: bq-awards-post-apply-verify.ts <capture|verify>');
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'post-apply verify failed');
  process.exit(1);
});
