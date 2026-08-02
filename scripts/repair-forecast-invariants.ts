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

config({ path: '.env.local', override: true });
const GO = process.argv.includes('--go');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

/** "2026" → "FY2026"; "FY26" → "FY2026"; "TBD" → null. */
export function normalizeFy(v: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  const m = /^FY?\s?(\d{4})$/.exec(s) || /^(20\d{2})$/.exec(s);
  if (m) { const n = Number(m[1]); return n >= 2020 && n <= 2040 ? `FY${m[1]}` : null; }
  const short = /^FY\s?(\d{2})$/.exec(s);
  if (short) { const n = 2000 + Number(short[1]); return n >= 2020 && n <= 2040 ? `FY${n}` : null; }
  return null;   // "TBD" and anything else unparseable
}

/**
 * Placeholder text that means "no value", written into a field as if it were
 * one. DHS stores the literal "NA" in pop_state; several sources write "TBD" or
 * "Multiple" into pop_city. These render on a card as though they were real.
 * Deliberately NARROW — it must not swallow a real place ("Various" is here,
 * but "Various Locations, TX" would not match because of the anchors).
 */
const PLACEHOLDER = /^(n\/?a|na|tbd|tba|none|null|unknown|multiple|various|various locations|n\/a virtual|virtual|remote|- ?)$/i;

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
    const patch: Record<string, unknown> = {};
    const why: string[] = [];

    if (r.naics_code && !/^\d{6}$/.test(r.naics_code)) {
      patch.naics_code = null;
      why.push(`naics "${r.naics_code}"→null`);
    }
    const fy = normalizeFy(r.fiscal_year);
    if (r.fiscal_year && fy !== r.fiscal_year) {
      patch.fiscal_year = fy;
      why.push(`fy "${r.fiscal_year}"→${fy ?? 'null'}`);
    }
    if (r.estimated_value_min != null && r.estimated_value_min < 1000) {
      patch.estimated_value_min = null;
      why.push(`min ${r.estimated_value_min}→null`);
    }
    // Placeholder text in a LOCATION field. DHS stores the literal "NA" in
    // pop_state with "TBD"/"Multiple" in pop_city — not applicable, written as
    // data. It reads as a state code on a card and it is not one.
    if (r.pop_state && PLACEHOLDER.test(r.pop_state)) {
      patch.pop_state = null;
      why.push(`pop_state "${r.pop_state}"→null`);
    }
    if (r.pop_city && PLACEHOLDER.test(r.pop_city)) {
      patch.pop_city = null;
      why.push(`pop_city "${r.pop_city}"→null`);
    }
    // Swap only when BOTH survive the checks above and are still inverted.
    const min = patch.estimated_value_min === null ? null : r.estimated_value_min;
    if (min != null && r.estimated_value_max != null && min > r.estimated_value_max) {
      patch.estimated_value_min = r.estimated_value_max;
      patch.estimated_value_max = min;
      why.push(`swapped ${min}/${r.estimated_value_max}`);
    }

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
