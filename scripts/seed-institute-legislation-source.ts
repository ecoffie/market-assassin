/**
 * Seed the `institute_legislation` data_sources row — the freshness clock for the
 * Institute's legislative corpus.
 *
 * This is a CONFIG ROW (data, not DDL), so it goes through the service-role client
 * rather than the migration runner — same path `institute_gao` took.
 *
 * DRY-RUN BY DEFAULT. Pass --go to write. It is a single-row idempotent upsert on a
 * unique key, so re-running cannot duplicate or clobber the clocks block in notes.
 *
 *   npx tsx scripts/seed-institute-legislation-source.ts        # preview
 *   npx tsx scripts/seed-institute-legislation-source.ts --go   # write
 *
 * ⚠️ WHY THIS ROW MATTERS MORE THAN IT LOOKS. Without its own freshness clock, a
 * legislative ingest that silently stops looks exactly like a Congress that has not
 * acted. That is the FY2027 incident restated: absence must be VISIBLE. The row is
 * what makes "we have not checked" reportable.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const GO = process.argv.includes('--go');

const ROW = {
  key: 'institute_legislation',
  name: 'Mindy Institute — Federal Legislation',
  category: 'built_curated',
  built_from: 'api.congress.gov (bill list + text versions + committee reports)',
  refresh_cadence: 'weekly',
  is_active: true,
  notes:
    'Mindy Institute — federal legislative corpus. Source: https://api.congress.gov/v3 '
    + '(authenticated with the existing api.data.gov key; distinct from govinfo.gov, whose key is recorded invalid).\n'
    + 'Discovery is DYNAMIC: the collector pages the /bill/{congress} feed sorted by updateDate and matches on TITLE, '
    + 'so a new fiscal year\'s bill is found without a code change. No bill number, fiscal year, or Congress is hardcoded.\n'
    + 'ONE INSTITUTE ROW PER LEGISLATIVE VERSION — House introduced/reported/engrossed, Senate versions, committee reports, '
    + 'conference text and enacted law are separate documents with separate provenance and must never be collapsed.\n'
    + 'Cron: /api/cron/institute-legislation-sync (weekly).',
};

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: existing, error: readErr } = await db
    .from('data_sources')
    // unranged-ok: single row by the unique `key` column, terminated by maybeSingle().
    .select('key, name, refresh_cadence, last_built, is_active')
    .eq('key', ROW.key)
    .maybeSingle();

  // A read failure is UNKNOWN, never "row absent" (Bug Prevention Rule #11).
  if (readErr) {
    console.error('[seed] could not read data_sources — refusing to guess:', readErr.message);
    process.exit(1);
  }

  console.log(existing ? '[seed] row EXISTS:' : '[seed] row ABSENT — would insert:');
  console.log(JSON.stringify(existing ?? ROW, null, 2));

  if (!GO) {
    console.log('\n[seed] DRY RUN — nothing written. Re-run with --go to apply.');
    return;
  }

  // Do NOT overwrite notes on an existing row: the clocks block lives there and the
  // cron owns it. Only seed the row when it is genuinely absent.
  if (existing) {
    console.log('[seed] row already present — leaving notes/clocks untouched. Nothing to do.');
    return;
  }

  const { error } = await db.from('data_sources').insert(ROW);
  if (error) {
    console.error('[seed] insert failed:', error.message);
    process.exit(1);
  }
  console.log('[seed] inserted institute_legislation.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
