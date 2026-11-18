/**
 * Controlled DHS.gov APFS_forecast_allRecords ingest.
 *
 * Dry-run by default. Apply requires BOTH `--apply` AND `--i-authorize-apply`.
 * NEVER deletes orphans (absent_upstream is report-only).
 *
 *   npx tsx scripts/ingest-dhs-forecast-allrecords.ts
 *   npx tsx scripts/ingest-dhs-forecast-allrecords.ts --file ./APFS_forecast_allRecords.csv
 *   npx tsx scripts/ingest-dhs-forecast-allrecords.ts --url <url>
 *   npx tsx scripts/ingest-dhs-forecast-allrecords.ts --apply --i-authorize-apply --file ./file.csv
 *
 * ⚠️ Do NOT run --apply against production from this PR / CI. Release coordinator
 * owns any production import after dry-run evidence review.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { DHS_ALLRECORDS_CSV_URL } from '../src/lib/forecasts/dhs-allrecords';
import { runDhsAllrecordsIngest } from '../src/lib/forecasts/dhs-allrecords-ingest';

const argOf = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes('--apply');
const AUTHORIZE = process.argv.includes('--i-authorize-apply');
const LOCAL = argOf('file');
const URL_OVERRIDE = argOf('url');

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    }
  } catch { /* env may come from the shell */ }
}

async function main() {
  loadEnv();

  if (APPLY && !AUTHORIZE) {
    console.error('REFUSED: --apply requires --i-authorize-apply (explicit human authorization).');
    console.error('Dry-run is the default. Orphans are never deleted.');
    process.exit(2);
  }
  if (APPLY && AUTHORIZE) {
    console.warn('⚠️  APPLY AUTHORIZED — will INSERT/UPDATE matched DHS rows. Will NOT delete orphans.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  const sb = createClient(url, key);

  const sourceUrl = URL_OVERRIDE || DHS_ALLRECORDS_CSV_URL;
  let buffer: Buffer | undefined;
  if (LOCAL) {
    buffer = readFileSync(LOCAL);
    console.log(`source      ${LOCAL} (local)`);
  } else {
    console.log(`source      ${sourceUrl}`);
  }

  const result = await runDhsAllrecordsIngest(sb, {
    apply: APPLY && AUTHORIZE,
    buffer,
    fetchUrl: buffer ? undefined : sourceUrl,
  });

  if (!result.ok && !result.plan) {
    console.error(`\nFAILED: ${result.failure}`);
    process.exit(1);
  }

  console.log(`\nupstream     ${result.upstreamTotal} (usable ${result.usableUpstream})`);
  console.log(`missing APFS ${result.missingApfs}`);
  console.log(`duplicates   ${result.duplicateSourceIds}`);
  console.log(`matched      ${result.matchedExisting}  (changed ${result.changed} · unchanged ${result.unchanged})`);
  console.log(`new          ${result.newProven}`);
  console.log(`absent_up    ${result.absentUpstream}  (RETAINED — never deleted)`);
  if (result.sampleConflicts.length) {
    console.log('\nsample conflicts (changed fields):');
    for (const c of result.sampleConflicts) {
      console.log(`  • ${c.externalId}: ${c.changedFields.join(', ')}`);
    }
  }

  if (!(APPLY && AUTHORIZE)) {
    console.log(`\nDRY RUN — nothing written. Pass --apply --i-authorize-apply to mutate.`);
    if (result.failure) console.log(`note: ${result.failure}`);
    return;
  }

  console.log(`\napplied      inserts ${result.inserted}/${result.insertAttempted} · updates ${result.updated}/${result.updateAttempted}`);
  console.log(`dataAdvanced ${result.dataAdvanced}`);
  if (!result.ok) {
    console.error(`FAILED: ${result.failure}`);
    process.exit(1);
  }
  console.log('✓ done (no orphan deletes)');
}

main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
