/**
 * Ingest GSA Acquisition Gateway Export CSV packets into agency_forecasts.
 *
 * Restores the missing `gsa_gateway_csv` / `GW-L:` writer. Dry-run by default.
 * Apply requires BOTH `--apply` and `--i-authorize-apply`. Never deletes.
 * Never touches API twins. Exactly one `--agency` per run.
 *
 *   npx tsx scripts/ingest-gateway-csv.ts --dir ./packet --agency DOI
 *   npx tsx scripts/ingest-gateway-csv.ts --dir ./packet --agency DOI --apply --i-authorize-apply
 *
 * Prefer `npm run verify:gateway-exports -- <dir>` COMPLETE before apply.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  GATEWAY_CSV_AGENCIES,
  isGatewayCsvAgency,
} from '../src/lib/forecasts/gateway-csv-reconcile';
import { runGatewayCsvIngest } from '../src/lib/forecasts/gateway-csv-ingest';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      if (!process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    }
  } catch {
    /* env may come from the shell */
  }
}

async function main() {
  loadEnv();
  const dir = arg('dir');
  const agencyRaw = (arg('agency') || '').toUpperCase();
  const apply = process.argv.includes('--apply');
  const authorized = process.argv.includes('--i-authorize-apply');

  if (!dir || !agencyRaw) {
    console.error(
      'usage: npx tsx scripts/ingest-gateway-csv.ts --dir <packet> --agency <DOI|USDA|VA|DOT|GSA|DOL> [--apply --i-authorize-apply]',
    );
    console.error(`allowed agencies: ${GATEWAY_CSV_AGENCIES.join(', ')}`);
    process.exit(2);
  }
  if (!isGatewayCsvAgency(agencyRaw)) {
    console.error(`agency not allowed: ${agencyRaw}`);
    process.exit(2);
  }
  if (apply && !authorized) {
    console.error('REFUSED: --apply requires --i-authorize-apply');
    process.exit(2);
  }
  if (apply) {
    console.error('NOTE: apply is gated for release-coordinator approval — prefer dry-run.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('missing Supabase env');
    process.exit(1);
  }
  const sb = createClient(url, key);

  const result = await runGatewayCsvIngest(sb, {
    agency: agencyRaw,
    dir,
    apply: apply && authorized,
  });

  console.log('\n══ GATEWAY CSV INGEST ══\n');
  console.log(`agency           ${result.agency}`);
  console.log(`mode             ${result.applied ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`ok               ${result.ok}${result.failure ? ` (${result.failure})` : ''}`);
  console.log(`packet files     ${result.packetFiles}`);
  console.log(`packet rows      ${result.packetRows} (deduped Listing IDs)`);
  console.log(`wrong agency     ${result.wrongAgency}`);
  console.log(`before CSV count ${result.beforeCsvCount ?? 'unknown'}`);
  console.log(`after CSV count  ${result.afterCsvCount ?? 'unknown'}`);

  const p = result.plan;
  if (p) {
    console.log('\n── plan ──');
    console.log(`usable           ${p.usableUpstream}`);
    console.log(`matched          ${p.matchedExisting}`);
    console.log(`insert           ${p.toInsert.length}`);
    console.log(`update           ${p.toUpdate.length}`);
    console.log(`unchanged        ${p.unchanged}`);
    console.log(`absent upstream  ${p.absentUpstream.length} (REPORT ONLY — not deleted)`);
    console.log(`api twin overlap ${p.twinApiOverlap.length} (REPORT ONLY — not mutated)`);
    console.log(`parse rejected   ${p.parseRejected}`);
    console.log(`dup source ids   ${p.duplicateSourceIds.length}`);
    if (p.toUpdate.length) {
      console.log('\nsample updates:');
      for (const u of p.toUpdate.slice(0, 5)) {
        console.log(`  ${u.externalId}: ${u.changedFields.join(', ')}`);
      }
    }
    if (p.toInsert.length) {
      console.log('\nsample inserts:');
      for (const r of p.toInsert.slice(0, 5)) {
        console.log(`  ${r.external_id}: ${(r.title as string || '').slice(0, 60)}`);
      }
    }
    if (p.absentUpstream.length) {
      console.log('\nsample absent (kept):');
      for (const id of p.absentUpstream.slice(0, 5)) console.log(`  ${id}`);
    }
    if (p.twinApiOverlap.length) {
      console.log('\nsample api twins (untouched):');
      for (const id of p.twinApiOverlap.slice(0, 5)) console.log(`  ${id}`);
    }
  }

  if (result.applied) {
    console.log(`\nwrite receipts   inserted=${result.inserted}/${result.insertAttempted} updated=${result.updated}/${result.updateAttempted}`);
  } else {
    console.log('\nDRY RUN — nothing written. Re-run with --apply --i-authorize-apply only after release-coordinator approval.');
  }

  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});
