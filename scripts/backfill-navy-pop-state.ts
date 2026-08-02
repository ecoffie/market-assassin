/**
 * Backfill Navy LRAE pop_state/pop_city/pop_country from the
 * "Anticipated Place of Performance" column already captured in raw_data.
 *
 * WHY: the LRAE parser stored the source row but never mapped its place column,
 * so 5,026 Navy forecasts reached the map with no location — the same
 * capture-but-never-map bug as EPA, at 200x the scale. Found by the
 * map-coverage audit (src/lib/forecasts/map-coverage.ts).
 *
 * This is the RECOVERABLE_FORMAT response from that policy: the data is already
 * in the table, so the fix is a re-read, not a re-download.
 *
 * Only touches rows where pop_state IS NULL. Dry by default; --go to write.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { resolveNavyPlace, isNavyNonPlace } from '../src/lib/forecasts/navy-installations';

config({ path: '.env.local', override: true });
const GO = process.argv.includes('--go');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

async function main() {
  const rows: Array<{ id: string; raw_data: Record<string, unknown> | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('id, raw_data').eq('source_agency', 'NAVY').is('pop_state', null)
      .order('id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }
  console.log(`NAVY rows with no pop_state: ${rows.length}`);

  const updates: Array<{ id: string; pop_city: string | null; pop_state: string | null; pop_country: string | null; from: string }> = [];
  let nonPlace = 0, unresolved = 0, noColumn = 0;

  for (const r of rows) {
    const sr = (r.raw_data?.source_row ?? {}) as Record<string, string>;
    const pop = sr['Anticipated Place of Performance'];
    if (!pop) { noColumn++; continue; }
    if (isNavyNonPlace(String(pop))) { nonPlace++; continue; }
    const p = resolveNavyPlace(pop);
    if (!p) { unresolved++; continue; }
    updates.push({
      id: r.id,
      pop_city: p.city ?? null,
      pop_state: p.state ?? null,
      // ISO3 for OCONUS so the geocoder's foreign branch fires; 'USA' otherwise.
      pop_country: p.country ?? 'USA',
      from: String(pop),
    });
  }

  console.log(`  resolvable to a place : ${updates.length}`);
  console.log(`  honest non-place      : ${nonPlace}  (TBD / VENDOR'S FACILITY / % splits)`);
  console.log(`  unresolved shorthand  : ${unresolved}  (contract-vehicle codes, multi-base regions)`);
  console.log(`  no place column       : ${noColumn}`);

  console.log('\nsample:');
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.from.padEnd(28)} → ${[u.pop_city, u.pop_state, u.pop_country !== 'USA' ? u.pop_country : ''].filter(Boolean).join(', ')}`);
  }

  if (!GO) {
    console.log(`\nDRY RUN — nothing written. ${updates.length} rows would be updated.`);
    console.log('Re-run with --go, then run backfill-forecast-latlng.ts --go to place the pins.');
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { error } = await db.from('agency_forecasts')
      .update({ pop_city: u.pop_city, pop_state: u.pop_state, pop_country: u.pop_country })
      .eq('id', u.id);
    if (error) { console.error(`  ✗ ${u.id}: ${error.message}`); continue; }
    written++;
    if (written % 250 === 0) console.log(`  wrote ${written}/${updates.length}`);
  }
  console.log(`\n✓ ${written} Navy rows given a place. Now run: npx tsx scripts/backfill-forecast-latlng.ts --go`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
