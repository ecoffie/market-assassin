#!/usr/bin/env npx tsx
/**
 * Backfill sam_opportunities.map_lat / map_lng / map_loc_source so OPEN opportunities can be
 * viewport-queried and pinned — the same treatment recompete / forecast / dibbs already got.
 *
 * WHY THIS EXISTS. Measured 2026-09-12: only 513 of 11,012 open opps (4.7%) had coordinates,
 * and EVERY one was posted 2026-08-06..08-14 — zero of the 8,292 posted in September. There is
 * no geocode cron (40 jobs, none geocode SAM) and, unlike the other three horizons, no backfill
 * script. Meanwhile office_address->>state is populated on 10,867/11,012 (98.7%): the source
 * data was always there, it was simply never turned into coordinates. state-centroids.ts has
 * said "City-precision geocoding is a fast-follow" since it was written.
 *
 * The user-visible damage is NOT an empty map, it is a WRONG NUMBER: filters work perfectly and
 * return almost nothing, so the headline count reads as market truth when it is only "rows we
 * could plot". Real saved searches, measured: NJ construction 0 shown / 31 real,
 * TX 541-series 0 / 24, janitorial 0 / 42, VA 30 / 1,802.
 *
 * PURE LOOKUP — no external API, no network geocoding. Reuses resolvePinCoord() from
 * src/lib/opportunities/map-data.ts, the SAME chain the map itself uses:
 *   OCONUS country -> world city/country centroid (never placed on US soil)
 *   pop city+state -> pop ZIP -> office ZIP -> office city+state -> state centroid
 * so a backfilled pin lands exactly where the map would already have drawn it. A row whose
 * state cannot be resolved is LEFT NULL — an honest gap, never a fabricated coordinate.
 *
 *   npx tsx scripts/backfill-sam-map-latlng.ts            # DRY-RUN (default) — zero writes
 *   npx tsx scripts/backfill-sam-map-latlng.ts --json     # machine-readable dry-run
 *   npx tsx scripts/backfill-sam-map-latlng.ts --apply    # WRITE (requires explicit approval)
 *   npx tsx scripts/backfill-sam-map-latlng.ts --all      # include already-mapped rows
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolvePinCoord, geocode } from '../src/lib/opportunities/map-data';
import { normalizeStateCode } from '../src/lib/utils/us-states';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const JSON_OUT = process.argv.includes('--json');
const PAGE = 1000;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * THE JUNK-CITY GUARD. 484 unmapped rows carry a NUMERIC "city": "0" (~330 rows — 0|OK 48,
 * 0|CA 41, 0|TX 38) and ZIPs sitting in the city field ("77416|DC" 13, "53470|VA" 7).
 *
 * These must NEVER be reported as exact/city. "0" is a placeholder, not a place; a ZIP in the
 * city column is a data-entry error, and treating it as a city NAME is how you end up
 * confidently pinning a row somewhere it isn't. They degrade to the ZIP/centroid path like any
 * other unresolvable city. (A real ZIP still geocodes — via pop_zip, its actual column.)
 */
export function isJunkCity(city: string | null | undefined): boolean {
  const c = String(city ?? '').trim();
  return c === '' || /^\d+$/.test(c);
}

type Row = {
  notice_id: string; title: string | null;
  pop_city: string | null; pop_state: string | null; pop_zip: string | null; pop_country: string | null;
  office_address: { city?: string; state?: string; zipcode?: string } | null;
  map_lat: number | null;
};

type Precision = 'exact/city' | 'state-approx' | 'unplaced';
type Src = 'pop city/state' | 'pop ZIP' | 'office ZIP' | 'office city/state' | 'state-only' | 'OCONUS' | 'none';

/**
 * Classify ONE row: the precision we would persist and which field produced it.
 * Mirrors resolvePinCoord's own precedence — we re-derive the SOURCE label (which the shared
 * fn doesn't expose) by replaying the same `geocode()` it calls, so the report describes the
 * real decision rather than a guess about it.
 */
function classify(r: Row): { precision: Precision; src: Src; state: string | null; key: string } {
  const popCityRaw = (r.pop_city || '').trim();
  const popCity = isJunkCity(popCityRaw) ? '' : popCityRaw;          // junk guard
  const popState = normalizeStateCode(r.pop_state || '');
  const office = r.office_address || null;
  const offCityRaw = (office?.city || '').trim();
  const offCity = isJunkCity(offCityRaw) ? '' : offCityRaw;
  const offState = normalizeStateCode(office?.state || '');

  // Replay the shared chain with junk cities stripped.
  const g = geocode(popCity, popState, office ? { ...office, city: offCity } : null, r.pop_zip, r.pop_country);

  const iso3 = (r.pop_country || '').toUpperCase().trim();
  const foreign = !!iso3 && iso3 !== 'USA' && iso3 !== 'US';

  if (!g.state) return { precision: 'unplaced', src: 'none', state: null, key: '(no state)' };
  if (foreign && g.coord) return { precision: 'exact/city', src: 'OCONUS', state: g.state, key: `${g.city || '(country)'}|${g.state}` };

  const coord = resolvePinCoord(r);
  if (!coord) return { precision: 'unplaced', src: 'none', state: g.state, key: `(no centroid)|${g.state}` };

  if (g.coord) {
    // A real coordinate match (city or ZIP), not the centroid fallback.
    let src: Src = 'office city/state';
    if (popCity && popState && g.source === 'pop') src = 'pop city/state';
    else if (g.source === 'pop') src = 'pop ZIP';
    else if (office?.zipcode && !offCity) src = 'office ZIP';
    return { precision: 'exact/city', src, state: g.state, key: `${(g.city || '').toUpperCase()}|${g.state}` };
  }
  // Centroid fallback — correct state, approximate point.
  const which = popState ? 'pop' : 'office';
  const missedCity = which === 'pop' ? popCityRaw : offCityRaw;
  return {
    precision: 'state-approx',
    src: 'state-only',
    state: g.state,
    key: missedCity ? `${missedCity.toUpperCase()}|${g.state}` : `(state only)|${g.state}`,
  };
}

async function fetchAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from('sam_opportunities')
      .select('notice_id, title, pop_city, pop_state, pop_zip, pop_country, office_address, map_lat')
      .eq('active', true).gt('response_deadline', new Date().toISOString())
      .order('notice_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!ALL) q = q.is('map_lat', null);
    const { data, error } = await q;
    if (error) throw new Error(`fetch failed at ${from}: ${error.message}`); // surface, never swallow
    const batch = (data || []) as Row[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function pct(n: number, d: number) { return d ? ((100 * n) / d).toFixed(1) + '%' : '0.0%'; }

async function main() {
  const rows = await fetchAll();

  const byPrecision: Record<Precision, number> = { 'exact/city': 0, 'state-approx': 0, unplaced: 0 };
  const bySrc: Record<string, number> = {};
  const approxKeys: Record<string, number> = {};
  const unplacedKeys: Record<string, number> = {};
  const samples: Record<Precision, Array<Record<string, unknown>>> = { 'exact/city': [], 'state-approx': [], unplaced: [] };
  const writes: Array<{ notice_id: string; map_lat: number; map_lng: number; map_loc_source: string }> = [];
  let junk = 0;

  for (const r of rows) {
    if (isJunkCity(r.pop_city) && String(r.pop_city ?? '').trim() !== '') junk++;
    const c = classify(r);
    byPrecision[c.precision]++;
    bySrc[c.src] = (bySrc[c.src] || 0) + 1;
    if (c.precision === 'state-approx') approxKeys[c.key] = (approxKeys[c.key] || 0) + 1;
    if (c.precision === 'unplaced') unplacedKeys[c.key] = (unplacedKeys[c.key] || 0) + 1;
    if (samples[c.precision].length < 20) {
      samples[c.precision].push({
        notice_id: r.notice_id,
        title: (r.title || '').slice(0, 46),
        pop: `${r.pop_city || '—'}, ${r.pop_state || '—'}`,
        zip: r.pop_zip || '—',
        office: `${r.office_address?.city || '—'}, ${r.office_address?.state || '—'}`,
        src: c.src, state: c.state,
      });
    }
    if (c.precision !== 'unplaced') {
      const coord = resolvePinCoord(r);
      if (coord) writes.push({ notice_id: r.notice_id, map_lat: coord.lat, map_lng: coord.lng, map_loc_source: coord.source });
    }
  }

  const placeable = byPrecision['exact/city'] + byPrecision['state-approx'];

  if (JSON_OUT) {
    console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', scanned: rows.length, byPrecision, bySrc, junkCities: junk, wouldWrite: writes.length }, null, 2));
  } else {
    const line = '─'.repeat(74);
    console.log(`\n${line}\n  SAM OPEN GEOCODE — ${APPLY ? 'APPLY' : 'DRY-RUN (zero writes)'}\n${line}`);
    console.log(`  scanned (unmapped open rows) : ${rows.length.toLocaleString()}`);
    console.log(`  junk numeric "city" rejected : ${junk.toLocaleString()}  (never counted as exact/city)\n`);

    console.log('  PRECISION');
    for (const p of ['exact/city', 'state-approx', 'unplaced'] as Precision[]) {
      console.log(`    ${p.padEnd(14)} ${String(byPrecision[p]).padStart(7)}  ${pct(byPrecision[p], rows.length).padStart(6)}`);
    }
    console.log(`    ${'TOTAL'.padEnd(14)} ${String(rows.length).padStart(7)}\n`);

    console.log('  SOURCE');
    for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(18)} ${String(v).padStart(7)}  ${pct(v, rows.length).padStart(6)}`);
    }

    const top = (o: Record<string, number>, n: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    console.log('\n  TOP UNRESOLVED CITY KEYS (fell back to state-approx)');
    for (const [k, v] of top(approxKeys, 20)) console.log(`    ${String(v).padStart(5)}  ${k}`);
    if (Object.keys(unplacedKeys).length) {
      console.log('\n  TOP UNPLACED KEYS (no pin — honest gap)');
      for (const [k, v] of top(unplacedKeys, 10)) console.log(`    ${String(v).padStart(5)}  ${k}`);
    }

    for (const p of ['exact/city', 'state-approx', 'unplaced'] as Precision[]) {
      if (!samples[p].length) continue;
      console.log(`\n  SAMPLE — ${p} (${Math.min(20, samples[p].length)} of ${byPrecision[p]})`);
      for (const s of samples[p]) {
        console.log(`    ${String(s.notice_id).slice(0, 10)}  pop=${String(s.pop).padEnd(26).slice(0, 26)} zip=${String(s.zip).padEnd(6)} off=${String(s.office).padEnd(22).slice(0, 22)} via ${s.src}`);
      }
    }

    const before = 513, openTotal = 11012;
    console.log(`\n  COVERAGE (open corpus = ${openTotal.toLocaleString()})`);
    console.log(`    before : ${String(before).padStart(6)}  ${pct(before, openTotal).padStart(6)}`);
    console.log(`    after  : ${String(before + placeable).padStart(6)}  ${pct(before + placeable, openTotal).padStart(6)}   (+${placeable.toLocaleString()})`);
    console.log(`    still unplaced : ${byPrecision.unplaced} — legitimately not a US location\n`);
    console.log(`  would write ${writes.length.toLocaleString()} rows.`);
    console.log(APPLY ? '  MODE: APPLY — writing.\n' : '  MODE: DRY-RUN — no writes performed. Re-run with --apply after approval.\n');
  }

  if (!APPLY) return;

  let written = 0;
  for (let i = 0; i < writes.length; i += 500) {
    const chunk = writes.slice(i, i + 500);
    const { error } = await db.from('sam_opportunities').upsert(chunk, { onConflict: 'notice_id' });
    if (error) throw new Error(`write failed at ${i}: ${error.message}`);
    written += chunk.length;
    process.stdout.write(`\r  written ${written}/${writes.length}`);
  }
  console.log(`\n  done — ${written} rows updated.\n`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
