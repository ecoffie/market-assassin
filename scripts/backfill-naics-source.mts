/**
 * BACKFILL naics_source — establish provenance only where the data proves it.
 *
 * MEASURED 2026-08-25 across all 10,700 rows:
 *   7,928  EXACT 5-code placeholder, nothing else   -> system_default
 *   1,850  a NAICS set that is not the placeholder  -> user_confirmed
 *     922  no NAICS at all                          -> left NULL (nothing to attribute)
 *     124  contain all 5 defaults PLUS extras       -> left NULL (AMBIGUOUS)
 *
 * ⚠️ THE 124 STAY NULL. Calling them user_confirmed assumes the user deliberately kept a
 * default they never chose; calling them system_default ignores codes they clearly added.
 * Provenance cannot be established from the data, and inventing it would recreate the
 * exact false-completeness problem this column exists to end. NULL is a real answer.
 *
 *   npx tsx scripts/backfill-naics-source.mts          # dry run (default)
 *   npx tsx scripts/backfill-naics-source.mts --go     # write
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const GO = process.argv.includes('--go');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** The placeholder written when onboarding had nothing. Never a user choice. */
const PLACEHOLDER = ['541512', '541611', '541330', '541990', '561210'];
const PLACEHOLDER_KEY = [...PLACEHOLDER].sort().join(',');

type Row = { user_email: string; naics_codes: string[] | null };

async function allRows(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .order('user_email', { ascending: true })
      .range(from, from + 999);   // truncation-ok: paged to exhaustion
    if (error) throw new Error(error.message);
    out.push(...((data || []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function classify(codes: string[] | null): 'system_default' | 'user_confirmed' | null {
  if (!Array.isArray(codes) || codes.length === 0) return null;          // nothing to attribute
  const set = codes.map(String);
  if (set.length === 5 && [...set].sort().join(',') === PLACEHOLDER_KEY) return 'system_default';
  // Contains every default PLUS extras — did they choose, or default-then-add? Unknowable.
  if (PLACEHOLDER.every((d) => set.includes(d))) return null;
  return 'user_confirmed';
}

async function main() {
  const rows = await allRows();
  const buckets = { system_default: [] as Row[], user_confirmed: [] as Row[], ambiguous: 0, empty: 0 };
  for (const r of rows) {
    const c = classify(r.naics_codes);
    if (c) buckets[c].push(r);
    else if (Array.isArray(r.naics_codes) && r.naics_codes.length) buckets.ambiguous++;
    else buckets.empty++;
  }

  console.log(`\n  ══ naics_source backfill ${GO ? '(WRITING)' : '(DRY RUN)'} ══\n`);
  console.log(`  rows scanned        ${rows.length.toLocaleString()}`);
  console.log(`  → system_default    ${String(buckets.system_default.length).padStart(6)}`);
  console.log(`  → user_confirmed    ${String(buckets.user_confirmed.length).padStart(6)}`);
  console.log(`  → NULL (ambiguous)  ${String(buckets.ambiguous).padStart(6)}  contain all 5 defaults + extras`);
  console.log(`  → NULL (no NAICS)   ${String(buckets.empty).padStart(6)}`);

  if (!GO) { console.log('\n  DRY RUN — nothing written. Re-run with --go.\n'); return; }

  let written = 0, failed = 0;
  for (const [value, list] of [['system_default', buckets.system_default], ['user_confirmed', buckets.user_confirmed]] as const) {
    for (let i = 0; i < list.length; i += 200) {
      const emails = list.slice(i, i + 200).map((r) => r.user_email);
      // UPDATE, never upsert: every other column must stay untouched, and an upsert would
      // send a full INSERT that fires NOT NULL constraints on columns we are not setting.
      const { error, count } = await sb
        .from('user_notification_settings')
        .update({ naics_source: value }, { count: 'exact' })
        .in('user_email', emails);
      if (error) { failed += emails.length; console.error(`  write failed (${value}):`, error.message); continue; }
      written += count ?? emails.length;
      process.stderr.write(`\r  writing… ${written}`);
    }
  }
  console.log(`\n\n  wrote ${written.toLocaleString()} rows${failed ? `, ${failed} FAILED` : ''}`);

  // Reconcile against the database, not against our own loop counter.
  const verify: Record<string, number | null> = {};
  for (const v of ['system_default', 'user_confirmed']) {
    const { count } = await sb.from('user_notification_settings').select('*', { count: 'exact', head: true }).eq('naics_source', v);
    verify[v] = count;
  }
  const { count: nulls } = await sb.from('user_notification_settings').select('*', { count: 'exact', head: true }).is('naics_source', null);
  console.log(`\n  verified in DB:`);
  console.log(`    system_default  ${verify.system_default}`);
  console.log(`    user_confirmed  ${verify.user_confirmed}`);
  console.log(`    NULL            ${nulls}   (ambiguous + no-NAICS — provenance genuinely unknown)`);
}

main().catch((e) => { console.error('\n  FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
