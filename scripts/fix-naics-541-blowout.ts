#!/usr/bin/env npx tsx
/**
 * Collapse the 541-family NAICS blow-out on user_notification_settings.
 *
 * ROOT CAUSE (fixed in code 2026-07-27): the industry picker offers broad short
 * prefixes ("Professional Services" = ['541']) and the PERSIST path ran the
 * QUERY-time expander, so one click stored all 51 codes of the 541 family.
 *
 * COHORT (option A — the provably-safe segment only): profiles holding EXACTLY
 * the 51-code 541 family and nothing else. 710 rows, 2 distinct arrays that
 * differ only in the sort position of 541614 — i.e. byte-identical content.
 * 710 identical arrays cannot be independent user choices, so collapsing them
 * back to the curated coverage set is provably correct rather than heuristic.
 *
 * NOT IN SCOPE: the other 379 bloated profiles (mixed families, bare stubs).
 * Those interleave real user-chosen codes with blow-out and would need a
 * judgment-call heuristic — deliberately left for a separate reviewed pass.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. Writes nothing without --go.
 *   - Always writes a JSON backup of (user_email, naics_codes) BEFORE any
 *     update, including on a dry run. Restore with --restore <file>.
 *   - Re-verifies each row still matches the cohort immediately before writing,
 *     so a profile edited since the scan is skipped rather than clobbered.
 *   - Idempotent: a row already at the curated set no longer matches the cohort.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   npx tsx scripts/fix-naics-541-blowout.ts            # dry run + backup
 *   npx tsx scripts/fix-naics-541-blowout.ts --go       # apply
 *   npx tsx scripts/fix-naics-541-blowout.ts --restore backups/<file>.json
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { normalizeNAICSForPersist } from '../src/lib/utils/naics-expansion';

const GO = process.argv.includes('--go');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE_FILE = restoreIdx > -1 ? process.argv[restoreIdx + 1] : null;

// The curated replacement — exactly what a "Professional Services" click now
// persists via normalizeNAICSForPersist(['541']).
const CURATED_541 = normalizeNAICSForPersist(['541']);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = { user_email: string; naics_codes: string[] };

/** Cohort test: exactly 51 codes, every one inside the 541 family. */
function isPure541(codes: string[] | null): boolean {
  if (!Array.isArray(codes) || codes.length !== 51) return false;
  return codes.every((c) => typeof c === 'string' && c.startsWith('541'));
}

async function fetchCohort(): Promise<Row[]> {
  // Paginate — PostgREST caps a single page at 1000.
  const out: Row[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .not('naics_codes', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Row[]).filter((r) => isPure541(r.naics_codes)));
    if (data.length < PAGE) break;
  }
  return out;
}

async function restore(file: string) {
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
  console.log(`Restoring ${rows.length} profiles from ${file}...`);
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const { error } = await db
      .from('user_notification_settings')
      .update({ naics_codes: r.naics_codes, updated_at: new Date().toISOString() })
      .eq('user_email', r.user_email);
    if (error) {
      failed++;
      console.error(`  FAIL ${r.user_email}: ${error.message}`);
    } else ok++;
  }
  console.log(`Restored ${ok}, failed ${failed}.`);
}

async function main() {
  if (RESTORE_FILE) {
    await restore(RESTORE_FILE);
    return;
  }

  console.log(`Curated replacement (${CURATED_541.length} codes): ${CURATED_541.join(', ')}\n`);

  const cohort = await fetchCohort();
  console.log(`Cohort matched: ${cohort.length} profiles holding the pure 51-code 541 family.`);
  if (cohort.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Backup BEFORE any write — on dry runs too, so the file exists to restore from.
  mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `backups/naics-541-blowout-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(cohort, null, 2));
  console.log(`Backup written: ${backupFile} (${cohort.length} rows)\n`);

  console.log('Sample of what changes:');
  for (const r of cohort.slice(0, 3)) {
    console.log(`  ${r.user_email}: ${r.naics_codes.length} -> ${CURATED_541.length} codes`);
  }

  if (!GO) {
    console.log(`\nDRY RUN — nothing written. ${cohort.length} profiles would go 51 -> ${CURATED_541.length} codes.`);
    console.log('Re-run with --go to apply.');
    return;
  }

  console.log(`\nApplying to ${cohort.length} profiles...`);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of cohort) {
    // Re-read immediately before writing: if the user edited their profile since
    // the scan, it no longer matches the cohort and must NOT be overwritten.
    const { data: fresh, error: readErr } = await db
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', r.user_email)
      .maybeSingle();
    if (readErr) {
      failed++;
      console.error(`  FAIL(read) ${r.user_email}: ${readErr.message}`);
      continue;
    }
    if (!fresh || !isPure541(fresh.naics_codes)) {
      skipped++;
      continue;
    }

    const { error } = await db
      .from('user_notification_settings')
      .update({ naics_codes: CURATED_541, updated_at: new Date().toISOString() })
      .eq('user_email', r.user_email);
    if (error) {
      failed++;
      console.error(`  FAIL ${r.user_email}: ${error.message}`);
    } else {
      updated++;
      if (updated % 100 === 0) console.log(`  ...${updated}/${cohort.length}`);
    }
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
  console.log(`Restore with: npx tsx scripts/fix-naics-541-blowout.ts --restore ${backupFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
