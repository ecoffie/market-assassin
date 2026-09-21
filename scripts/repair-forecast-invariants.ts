/**
 * Repair the invariant violations the ORACLE found (scripts/oracle-forecasts.ts).
 *
 * These are normalisation defects, not transcription errors, so they are fixed
 * in place rather than by re-ingest — the source value is recoverable from what
 * is stored:
 *
 *   naics_code = "TBD" / "54" / "1082720"   → NULL. A placeholder or a
 *       malformed code is not a NAICS. Storing "TBD" puts the literal word on a
 *       user's card and makes it look like a real classification. 521 rows,
 *       509 of them Navy.
 *   fiscal_year = "2026" / "FY26" / "TBD"   → "FY2026" / "FY2026" / NULL. The
 *       query filter matches on FY20xx, so a bare "2026" silently drops the row
 *       out of every future-year search. 107 rows.
 *   estimated_value_min < 1000              → NULL. A federal forecast floored
 *       below $1,000 is a malformed cell, not a real figure — usually a stray
 *       digit or a percentage read as money. 442 rows. The MAX is left alone;
 *       only the impossible bound is dropped.
 *   min > max                               → swap. 1 row.
 *
 * Every one of these DROPS a bad value rather than inventing a good one. Where
 * the true value is unrecoverable the field becomes NULL, which the map and the
 * card already render honestly.
 *
 * Dry by default; --go to write.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
// SHARED with the sync cron — the ingest applies these same rules at write time,
// so this script is now a backfill for rows written before that landed, not the
// only thing standing between the table and the oracle.
import { normalizeForecastRow, normalizeFy } from '../src/lib/forecasts/normalize-row';

config({ path: '.env.local', override: true });
const GO = process.argv.includes('--go');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);


interface Row {
  id: string; external_id: string | null; source_agency: string | null;
  naics_code: string | null; fiscal_year: string | null;
  estimated_value_min: number | null; estimated_value_max: number | null;
  pop_state: string | null; pop_city: string | null;
}

async function main() {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('id,external_id,source_agency,naics_code,fiscal_year,estimated_value_min,estimated_value_max,pop_state,pop_city')
      .order('id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  console.log(`scanned ${rows.length} forecasts`);

  const updates: Array<{ id: string; patch: Record<string, unknown>; why: string[] }> = [];
  for (const r of rows) {
    // ONE source of truth for the rules — the sync cron applies the same function
    // at write time, so the script and the ingest cannot drift apart.
    const patch: Record<string, unknown> = { ...normalizeForecastRow(r) };
    const why: string[] = Object.entries(patch).map(([k, v]) => {
      const was = (r as unknown as Record<string, unknown>)[k];
      return `${k} ${JSON.stringify(was)}→${v === null ? 'null' : JSON.stringify(v)}`;
    });

    // Clearing a location invalidates any pin derived from it.
    if ('pop_state' in patch || 'pop_city' in patch) { patch.map_lat = null; patch.map_lng = null; }

    if (Object.keys(patch).length) updates.push({ id: r.id, patch, why });
  }

  const byKind = new Map<string, number>();
  for (const u of updates) for (const w of u.why) {
    const k = w.split(' ')[0];
    byKind.set(k, (byKind.get(k) || 0) + 1);
  }
  console.log(`\nrows to repair: ${updates.length}`);
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log('\nsample:');
  for (const u of updates.slice(0, 10)) console.log(`  ${u.why.join(' · ')}`);

  if (!GO) {
    console.log(`\nDRY RUN — nothing written. ${updates.length} rows would change.`);
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { error } = await db.from('agency_forecasts').update(u.patch).eq('id', u.id);
    if (error) { console.error(`  ✗ ${u.id}: ${error.message}`); continue; }
    written++;
    if (written % 250 === 0) console.log(`  wrote ${written}/${updates.length}`);
  }
  console.log(`\n✓ ${written} rows repaired. Re-run scripts/oracle-forecasts.ts to confirm.`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
