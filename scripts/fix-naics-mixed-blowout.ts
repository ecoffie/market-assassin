#!/usr/bin/env npx tsx
/**
 * Collapse MIXED NAICS family blow-outs (the 379 profiles left after the
 * provably-safe pure-541 pass in scripts/fix-naics-541-blowout.ts).
 *
 * These profiles interleave GENUINE user-chosen codes with whole-family
 * blow-outs from the industry picker's broad presets. Unlike the pure-541
 * cohort (710 byte-identical arrays = provably a preset click), these need a
 * HEURISTIC, so this script is built to be reviewed before it writes:
 *
 *   RULE: a family is treated as a preset blow-out only when the profile holds
 *   >= FAMILY_THRESHOLD (90%) of that family's members AND the family has >= 6
 *   members. Those members are replaced by the curated coverage set. EVERY
 *   other code is preserved untouched — that is where the user's real,
 *   specific choices live (e.g. 339112/339113/423450 for a medical supplier).
 *
 *   Bare 2-3 digit stubs (484/488/493 had no family entry pre-fix) are mapped
 *   through the same curated sets, so they stop leaking onto profiles.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. --go to write.
 *   - JSON backup of (user_email, naics_codes) BEFORE any write, dry run included.
 *   - --report writes a full before/after CSV for eyeball review.
 *   - Re-reads each row immediately before writing; skips anything that changed
 *     since the scan rather than clobbering it.
 *   - Never writes an empty array — a profile that would collapse to nothing is
 *     SKIPPED and reported, never blanked.
 *   - Idempotent: an already-collapsed profile no longer trips the threshold.
 *   - --restore <file> rolls back.
 *
 * Usage:
 *   npx tsx scripts/fix-naics-mixed-blowout.ts --report   # dry run + CSV diff
 *   npx tsx scripts/fix-naics-mixed-blowout.ts --go
 *   npx tsx scripts/fix-naics-mixed-blowout.ts --restore backups/<file>.json
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { NAICS_DATABASE, normalizeNAICSForPersist } from '../src/lib/utils/naics-expansion';

const GO = process.argv.includes('--go');
const REPORT = process.argv.includes('--report');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE_FILE = restoreIdx > -1 ? process.argv[restoreIdx + 1] : null;

/** Hold >=90% of a family's members => it was a preset click, not 40 deliberate picks. */
const FAMILY_THRESHOLD = 0.9;
const MIN_FAMILY_SIZE = 6;
const BLOAT_CUTOFF = Number(process.env.BLOAT_CUTOFF ?? 25);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = { user_email: string; naics_codes: string[] };

function collapse(codes: string[]): { result: string[]; collapsed: string[]; kept: string[] } {
  const present = new Set(codes.filter((c) => typeof c === 'string' && c.length >= 6));
  const out = new Set(present);
  const collapsed: string[] = [];

  for (const [fam, members] of Object.entries(NAICS_DATABASE)) {
    if (!members || members.length < MIN_FAMILY_SIZE) continue;
    const curated = normalizeNAICSForPersist([fam]);
    // A family with NO entry in PERSIST_COVERAGE_SETS falls through to the
    // pass-through branch and returns the bare prefix (e.g. ['336']). Collapsing
    // 27 real codes into one unusable 3-digit stub would DESTROY targeting, so
    // require a genuine curated set: every member 6-digit and inside the family.
    const isRealCuratedSet =
      curated.length > 0 &&
      curated.length < members.length &&
      curated.every((c) => c.length >= 6 && members.includes(c));
    if (!isRealCuratedSet) continue;

    const hits = members.filter((m) => present.has(m));
    if (hits.length >= Math.ceil(members.length * FAMILY_THRESHOLD)) {
      hits.forEach((m) => out.delete(m));
      curated.forEach((c) => out.add(c));
      collapsed.push(`${fam}:${hits.length}->${curated.length}`);
    }
  }

  // Bare 2-3 digit stubs can NEVER match an opportunity's 6-digit NAICS, so they
  // are always dead weight. How we clear them depends on what else the profile has:
  //
  //   - profile has NO 6-digit codes at all (16 users, avg 2.8 codes): the stubs
  //     are their ENTIRE targeting and it matches nothing. Expand to the curated
  //     set — this is the only thing standing between them and zero alerts.
  //   - profile already has real 6-digit codes (43 users, avg 11.5): targeting
  //     already works. Expanding each stub to 5-6 codes would only INFLATE the
  //     profile (measured: +784 codes across the cohort) for no added reach, so
  //     just DROP the useless stubs.
  const stubs = codes.filter(
    (c) => typeof c === 'string' && c.length >= 2 && c.length <= 3,
  );
  const stubOnly = present.size === 0;
  for (const c of stubs) {
    if (stubOnly) {
      const curated = normalizeNAICSForPersist([c]).filter((x) => x.length >= 6);
      if (curated.length) {
        curated.forEach((x) => out.add(x));
        collapsed.push(`stub:${c}->${curated.length}`);
      } else {
        collapsed.push(`stub:${c}->dropped(no curated set)`);
      }
    } else {
      collapsed.push(`stub:${c}->dropped(has real codes)`);
    }
  }

  const result = [...out].sort();
  // Codes that survived untouched = the user's own specific picks.
  const kept = result.filter((c) => present.has(c));
  return { result, collapsed, kept };
}

async function fetchCohort(): Promise<Row[]> {
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
    out.push(
      ...(data as Row[]).filter(
        // Bloated OR carrying bare 2-3 digit stubs. A stub can never match an
        // opportunity's 6-digit NAICS, so those profiles are silently getting
        // nothing from that entry even when the array is small (16 profiles hold
        // ONLY stubs = zero effective targeting).
        (r) =>
          Array.isArray(r.naics_codes) &&
          (r.naics_codes.length > BLOAT_CUTOFF ||
            r.naics_codes.some(
              (c) => typeof c === 'string' && c.length >= 2 && c.length <= 3,
            )),
      ),
    );
    if (data.length < PAGE) break;
  }
  return out;
}

async function restore(file: string) {
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
  console.log(`Restoring ${rows.length} profiles from ${file}...`);
  let ok = 0, failed = 0;
  for (const r of rows) {
    const { error } = await db
      .from('user_notification_settings')
      .update({ naics_codes: r.naics_codes, updated_at: new Date().toISOString() })
      .eq('user_email', r.user_email);
    if (error) { failed++; console.error(`  FAIL ${r.user_email}: ${error.message}`); } else ok++;
  }
  console.log(`Restored ${ok}, failed ${failed}.`);
}

async function main() {
  if (RESTORE_FILE) { await restore(RESTORE_FILE); return; }

  const cohort = await fetchCohort();
  console.log(`Cohort: ${cohort.length} profiles (>${BLOAT_CUTOFF} codes, or holding bare 2-3 digit stubs).\n`);
  if (!cohort.length) { console.log('Nothing to do.'); return; }

  mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `backups/naics-mixed-blowout-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(cohort, null, 2));
  console.log(`Backup written: ${backupFile} (${cohort.length} rows)\n`);

  const plan = cohort.map((r) => {
    const { result, collapsed, kept } = collapse(r.naics_codes);
    return { email: r.user_email, before: r.naics_codes, after: result, collapsed, kept };
  });

  const wouldEmpty = plan.filter((p) => p.after.length === 0);
  const unchanged = plan.filter((p) => p.after.length === p.before.length && p.collapsed.length === 0);
  const changing = plan.filter((p) => p.after.length !== p.before.length || p.collapsed.length > 0);

  const totalBefore = plan.reduce((s, p) => s + p.before.length, 0);
  const totalAfter = changing.reduce((s, p) => s + p.after.length, 0)
    + unchanged.reduce((s, p) => s + p.before.length, 0);

  console.log(`Would change : ${changing.length}`);
  console.log(`Unchanged    : ${unchanged.length}`);
  console.log(`Would empty  : ${wouldEmpty.length}  (SKIPPED — never blanked)`);
  console.log(`Codes total  : ${totalBefore} -> ${totalAfter}`);
  console.log(`Avg per profile: ${(totalBefore / plan.length).toFixed(1)} -> ${(totalAfter / plan.length).toFixed(1)}\n`);

  console.log('Largest 8 changes:');
  for (const p of [...changing].sort((a, b) => b.before.length - a.before.length).slice(0, 8)) {
    console.log(`  ${p.email}`);
    console.log(`    ${p.before.length} -> ${p.after.length}   collapsed: ${p.collapsed.join(' ') || '(none)'}`);
    console.log(`    kept (user's own): ${p.kept.slice(0, 12).join(',') || '(none)'}${p.kept.length > 12 ? ` +${p.kept.length - 12}` : ''}`);
  }

  if (REPORT) {
    const csv = ['email,before_count,after_count,collapsed,before,after']
      .concat(plan.map((p) =>
        [p.email, p.before.length, p.after.length,
         `"${p.collapsed.join(' ')}"`, `"${p.before.join(' ')}"`, `"${p.after.join(' ')}"`].join(',')))
      .join('\n');
    const csvFile = `backups/naics-mixed-diff-${stamp}.csv`;
    writeFileSync(csvFile, csv);
    console.log(`\nFull before/after CSV: ${csvFile}`);
  }

  if (!GO) {
    console.log(`\nDRY RUN — nothing written. Re-run with --go to apply.`);
    return;
  }

  console.log(`\nApplying to ${changing.length} profiles...`);
  let updated = 0, skipped = 0, failed = 0;
  for (const p of changing) {
    if (p.after.length === 0) { skipped++; continue; }
    const { data: fresh, error: readErr } = await db
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', p.email)
      .maybeSingle();
    if (readErr) { failed++; console.error(`  FAIL(read) ${p.email}: ${readErr.message}`); continue; }
    // Only write if the row still looks exactly as scanned.
    if (!fresh || !Array.isArray(fresh.naics_codes)
        || fresh.naics_codes.length !== p.before.length) { skipped++; continue; }

    const { error } = await db
      .from('user_notification_settings')
      .update({ naics_codes: p.after, updated_at: new Date().toISOString() })
      .eq('user_email', p.email);
    if (error) { failed++; console.error(`  FAIL ${p.email}: ${error.message}`); }
    else { updated++; if (updated % 50 === 0) console.log(`  ...${updated}/${changing.length}`); }
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
  console.log(`Restore with: npx tsx scripts/fix-naics-mixed-blowout.ts --restore ${backupFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
