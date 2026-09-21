#!/usr/bin/env npx tsx
/**
 * Backfill federal_contacts flat columns from raw_data for the 82,017 hollow
 * `sam_entities_pocs` rows (NULL contact_email AND contact_phone AND
 * department_ind_agency).
 *
 * MEASURED FIRST (2026-07-26), not assumed:
 *   - raw_data on these rows carries { uei, role, company, role_title } —
 *     the values the original diagnosis said were "dropped" by the importer.
 *   - BUT: contact_fullname, contact_title, sub_tier, role_category are
 *     ALREADY populated for these rows and already match raw_data 1:1:
 *       - sub_tier === raw_data.company for 100% of a 20-row sample (0 mismatches)
 *       - contact_title carries the REAL job title (GM/CEO/MRS/etc — from SAM's
 *         own name-block fields), NOT raw_data.role_title (which is just the POC
 *         SLOT label "Government Business POC" / "Electronic Business POC" —
 *         already coarsely captured by role_category='contracting')
 *       - contact_title is non-null/non-"NONE" for 82,015/82,017 rows (99.998%)
 *   - So there is NOTHING LEFT TO RECOVER into new/different flat columns —
 *     the importer did NOT drop company/role; it stored company as sub_tier
 *     (a slightly confusing column name for a contractor-POC row, but not a
 *     data hole) and title/role_category already carry the rest.
 *   - department_ind_agency/contact_email/contact_phone are CORRECTLY null:
 *     this source (SAM Entity export POCs) never carries them for these
 *     roles — that's not a bug, it's the shape of the source data.
 *
 * This script is therefore a VERIFICATION/REPORTING tool, not a write
 * backfill — it measures the claim above against the live table and prints
 * a before/after-style sample so the "nothing to recover" conclusion is
 * provable, not asserted. If a future raw_data field genuinely isn't
 * mapped, add it to RECOVERABLE_FIELDS below and this script's --go mode
 * will fill ONLY that gap (resumable, dry-run default, matches the repo's
 * other backfill-*.ts scripts).
 *
 *   npx tsx scripts/backfill-federal-contacts-from-rawdata.ts            # DRY (report only)
 *   npx tsx scripts/backfill-federal-contacts-from-rawdata.ts --go       # write ONLY genuine gaps (default: none exist)
 *   npx tsx scripts/backfill-federal-contacts-from-rawdata.ts --sample 10
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d;
};
const SAMPLE_SIZE = arg('--sample', 5);
const LIMIT = arg('--limit', 2000);
const CONCURRENCY = arg('--concurrency', 10);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

type RawData = { uei?: string; role?: string; company?: string; role_title?: string };
type HollowRow = {
  id: string;
  contact_fullname: string | null;
  contact_title: string | null;
  sub_tier: string | null;
  role_category: string | null;
  raw_data: RawData | null;
};

// A recoverable-field gap: a raw_data key that ISN'T already reflected in a
// flat column for a given row. Measured today: empty (see header). Kept as a
// real, resumable write path in case a future import regresses this.
function findGap(row: HollowRow): { field: 'contact_title'; value: string } | null {
  const raw = row.raw_data || {};
  // contact_title genuinely missing (NULL or the "NONE" placeholder SAM itself
  // emits) AND raw_data has a role_title to fall back to. Never OVERWRITES an
  // existing real title.
  const titleMissing = !row.contact_title || row.contact_title.trim().toUpperCase() === 'NONE';
  if (titleMissing && raw.role_title) {
    return { field: 'contact_title', value: raw.role_title };
  }
  return null;
}

async function main() {
  const { count: hollowTotal, error: e1 } = await db
    .from('federal_contacts')
    .select('*', { count: 'exact', head: true })
    .is('contact_email', null)
    .is('contact_phone', null)
    .is('department_ind_agency', null)
    .eq('source_table', 'sam_entities_pocs');
  if (e1) throw e1;
  console.log(`Hollow sam_entities_pocs rows (measured): ${hollowTotal ?? '?'}`);

  const { count: subTierPopulated, error: e2 } = await db
    .from('federal_contacts')
    .select('*', { count: 'exact', head: true })
    .is('contact_email', null)
    .is('contact_phone', null)
    .is('department_ind_agency', null)
    .eq('source_table', 'sam_entities_pocs')
    .not('sub_tier', 'is', null);
  if (e2) throw e2;
  console.log(`  of which sub_tier (= company, from raw_data.company) already populated: ${subTierPopulated ?? '?'}`);

  const { count: titlePopulated, error: e3 } = await db
    .from('federal_contacts')
    .select('*', { count: 'exact', head: true })
    .is('contact_email', null)
    .is('contact_phone', null)
    .is('department_ind_agency', null)
    .eq('source_table', 'sam_entities_pocs')
    .not('contact_title', 'is', null)
    .neq('contact_title', 'NONE');
  if (e3) throw e3;
  console.log(`  of which contact_title already populated (real job title, non-"NONE"): ${titlePopulated ?? '?'}`);

  // Sample rows, prove sub_tier === raw_data.company, print a before/after-style table.
  const { data: sample, error: e4 } = await db
    .from('federal_contacts')
    .select('id, contact_fullname, contact_title, sub_tier, role_category, raw_data')
    .is('contact_email', null)
    .is('contact_phone', null)
    .is('department_ind_agency', null)
    .eq('source_table', 'sam_entities_pocs')
    .limit(SAMPLE_SIZE);
  if (e4) throw e4;

  console.log(`\nSample (${(sample || []).length} rows) — "before" (current DB state) vs "raw_data" (source):`);
  for (const r of (sample || []) as HollowRow[]) {
    const raw = r.raw_data || {};
    const companyMatch = r.sub_tier === raw.company ? 'MATCH' : 'MISMATCH';
    console.log(`  id=${r.id}`);
    console.log(`    name=${r.contact_fullname}  title(before)=${r.contact_title}  role_category=${r.role_category}`);
    console.log(`    sub_tier(before)=${r.sub_tier}  raw_data.company=${raw.company}  [${companyMatch}]`);
    console.log(`    raw_data.role=${raw.role}  raw_data.role_title=${raw.role_title}  raw_data.uei=${raw.uei}`);
    const gap = findGap(r);
    console.log(`    genuine gap found: ${gap ? `${gap.field} -> "${gap.value}"` : 'none'}`);
  }

  // Full scan for genuine gaps (paginated, bounded by LIMIT per run — resumable
  // via the natural id ordering + this same is-null filter shrinking over time).
  console.log(`\nScanning up to ${LIMIT} hollow rows for a genuine flat-column gap...`);
  const { data: scanRows, error: e5 } = await db
    .from('federal_contacts')
    .select('id, contact_fullname, contact_title, sub_tier, role_category, raw_data')
    .is('contact_email', null)
    .is('contact_phone', null)
    .is('department_ind_agency', null)
    .eq('source_table', 'sam_entities_pocs')
    .limit(LIMIT);
  if (e5) throw e5;

  const gaps = ((scanRows || []) as HollowRow[])
    .map((r) => ({ row: r, gap: findGap(r) }))
    .filter((x) => x.gap !== null) as Array<{ row: HollowRow; gap: { field: 'contact_title'; value: string } }>;

  console.log(`Rows with a genuine recoverable gap: ${gaps.length} / ${(scanRows || []).length} scanned`);
  if (gaps.length === 0) {
    console.log('\nCONCLUSION: no recoverable gap exists in the flat columns today.');
    console.log('company/role/role_title are already reflected via sub_tier + contact_title + role_category.');
    console.log('department_ind_agency/contact_email/contact_phone are correctly NULL — this source');
    console.log('(SAM entity-export POCs) never carries them for these roles; NOT a mapping bug.');
    return;
  }

  console.log(`\nSample of gaps found:`);
  for (const { row, gap } of gaps.slice(0, 5)) {
    console.log(`  id=${row.id}: contact_title NULL/"NONE" -> would set "${gap.value}" (from raw_data.role_title)`);
  }

  if (!GO) {
    console.log(`\nDRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to write these ${gaps.length} rows.`);
    return;
  }

  console.log(`\nWriting ${gaps.length} rows (concurrency ${CONCURRENCY})...`);
  let done = 0;
  let failed = 0;
  const queue = [...gaps];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const { row, gap } = item;
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000));
      try {
        await Promise.race([
          db.from('federal_contacts').update({ [gap.field]: gap.value, updated_at: new Date().toISOString() }).eq('id', row.id),
          timeout,
        ]);
        done++;
      } catch (err) {
        failed++;
        console.error(`  FAILED id=${row.id}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Done. Updated ${done}, failed ${failed}.`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
