/**
 * Repair the truncated `pop_state` values written by the old Gateway parser.
 *
 * ⚠️ KEY NORMALISATION: the ingest turns "FY27_000158" into "GW-L:FY27-000158"
 * (underscore → hyphen). The first run of this script did NOT do that, so every
 * USDA row silently failed to join and went unrepaired — and I then cleared
 * those states as "unrecoverable" when the CSV had them all along. Both sides
 * of the key are normalised now.
 *
 * THE BUG: gateway-forecast.ts did a blind `.slice(0, 2)` on the
 * "Place of Performance State" column, assuming USPS codes. The Gateway export
 * holds full NAMES, so ~670 rows got the first two letters of a word —
 * "District of Columbia" → "DI", "Tennessee" → "TE", "North Carolina" → "NO".
 * None geocode.
 *
 * WHY A RE-READ AND NOT AN IN-PLACE MAP: the truncation is LOSSY. "NO" is North
 * Carolina or North Dakota; "SO" is South Carolina or South Dakota. Expanding
 * the stored value would be a coin flip. So this re-reads the ORIGINAL CSVs and
 * matches on the Gateway's own stable `Listing ID`, which is the only honest
 * way to recover the real state.
 *
 * Rows whose listing id is not in the CSVs are left ALONE and reported — a
 * missing id means the export no longer covers that row, not that its state is
 * unknowable.
 *
 * Dry by default; --go to write. Only touches pop_state/pop_city, and only
 * where the CSV gives a different (correct) answer.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { normalizeGatewayState } from '../src/lib/forecasts/gateway-forecast';

config({ path: '.env.local', override: true });
const GO = process.argv.includes('--go');
const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : `${process.env.HOME}/Downloads`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

/** Minimal CSV row splitter that respects quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

async function main() {
  // listing id → { state, city } straight from the source of truth.
  const truth = new Map<string, { state?: string; city?: string }>();
  const files = readdirSync(DIR).filter(f => /^forecast_export.*\.csv$/i.test(f));
  if (!files.length) { console.error(`No forecast_export*.csv in ${DIR}`); process.exit(1); }

  for (const f of files) {
    const lines = readFileSync(`${DIR}/${f}`, 'utf8').split(/\r?\n/);
    const hdr = splitCsvLine(lines[0] || '');
    const idI = hdr.indexOf('Listing ID');
    const stI = hdr.indexOf('Place of Performance State');
    const cyI = hdr.indexOf('Place of Performance City');
    if (idI < 0 || stI < 0) continue;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const c = splitCsvLine(line);
      const id = (c[idI] || '').trim().replace(/_/g, '-');
      if (!id) continue;
      truth.set(id, {
        state: normalizeGatewayState(c[stI]),
        city: cyI >= 0 && c[cyI] ? c[cyI] : undefined,
      });
    }
  }
  console.log(`CSV listing ids: ${truth.size} (from ${files.length} file(s))`);

  const rows: Array<{ id: string; external_id: string | null; pop_state: string | null; pop_city: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('id, external_id, pop_state, pop_city').eq('source_type', 'gsa_gateway_csv')
      .order('id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }
  console.log(`gateway rows in DB: ${rows.length}`);

  const updates: Array<{ id: string; state: string | null; city: string | null; was: string | null }> = [];
  let notInCsv = 0, alreadyRight = 0;
  for (const r of rows) {
    // external_id carries the Gateway listing id.
    const lid = (r.external_id || '').replace(/^GW-L:/i, '').replace(/_/g, '-');
    const t = truth.get(lid);
    if (!t) { notInCsv++; continue; }
    const wantState = t.state ?? null;
    const wantCity = t.city ?? r.pop_city ?? null;
    if (wantState === r.pop_state && wantCity === r.pop_city) { alreadyRight++; continue; }
    updates.push({ id: r.id, state: wantState, city: wantCity, was: r.pop_state });
  }

  console.log(`  to correct   : ${updates.length}`);
  console.log(`  already right: ${alreadyRight}`);
  console.log(`  not in CSV   : ${notInCsv}  (left untouched — a missing id is not a known-bad state)`);

  const byWas = new Map<string, number>();
  for (const u of updates) byWas.set(u.was ?? '(null)', (byWas.get(u.was ?? '(null)') || 0) + 1);
  console.log('\ncorrections by the BROKEN value:');
  [...byWas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  "${k}"`));
  console.log('\nsample:');
  for (const u of updates.slice(0, 8)) console.log(`  "${u.was}" → ${u.state ?? '(null)'}${u.city ? `, ${u.city}` : ''}`);

  if (!GO) {
    console.log(`\nDRY RUN — nothing written. ${updates.length} rows would change.`);
    console.log('Re-run with --go, then backfill-forecast-latlng.ts --go to place the pins.');
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { error } = await db.from('agency_forecasts')
      .update({ pop_state: u.state, pop_city: u.city, map_lat: null, map_lng: null })
      .eq('id', u.id);
    if (error) { console.error(`  ✗ ${u.id}: ${error.message}`); continue; }
    written++;
    if (written % 250 === 0) console.log(`  wrote ${written}/${updates.length}`);
  }
  console.log(`\n✓ ${written} rows corrected. Now run: npx tsx scripts/backfill-forecast-latlng.ts --go`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
