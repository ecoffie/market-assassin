/**
 * READ-ONLY: run the production awards completeness gate against the live warehouse now.
 *   npx tsx scripts/awards-completeness-gate.ts [--as-of=YYYY-MM-DD]
 * Exit 1 on FAIL (a settled warehouse hole or unmeasurable source), 0 on PASS/WARN.
 * Writes nothing. Staged-row integrity is not checked here (there is no staging run).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { BQ_TABLES } from '@/lib/bigquery/client';
import { formatCompletenessGate } from '@/lib/awards-ingest/completeness-gate';
import { runCompletenessGate } from '@/lib/awards-ingest/completeness-gate-run';

async function main(): Promise<void> {
  const asOf = process.argv.find((a) => a.startsWith('--as-of='))?.slice(8);
  const r = await runCompletenessGate({ awardsTable: BQ_TABLES.awards, asOf });
  for (const line of formatCompletenessGate(r)) console.log(line);
  process.exit(r.verdict === 'fail' ? 1 : 0);
}
main().catch((e) => { console.error('completeness gate could not run:', e instanceof Error ? e.message : e); process.exit(1); });
