#!/usr/bin/env npx tsx
/**
 * Backfill agency_forecasts.map_lat / map_lng / map_loc_source so the Forecasts layer of the
 * Opportunities map can be VIEWPORT-queried in SQL (bbox before limit), like SAM/DIBBS.
 * Forecast = the "coming work" horizon (Eric 2026-07-30). PURE geocode lookup, no external API:
 * reuses the shared resolvePinCoord() (city → ZIP → state-centroid fallback + deterministic
 * jitter) — the SAME chain SAM opps use, so a forecast pin sits where the geocoder would draw it.
 *
 * map_loc_source records precision: 'city' (real city/ZIP) vs 'state' (state-centroid fallback).
 * NULL lat = no resolvable state → LEFT NULL (honest gap; the row just won't pin). Idempotent +
 * resumable: only touches rows where map_lat IS NULL (unless --all). Migration
 * 20260731_forecast_map_latlng.sql adds the columns (hand-run first).
 *
 *   npx tsx scripts/backfill-forecast-latlng.ts          # DRY (counts + sample)
 *   npx tsx scripts/backfill-forecast-latlng.ts --go     # write
 *   npx tsx scripts/backfill-forecast-latlng.ts --go --all
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolvePinCoord } from '../src/lib/opportunities/map-data';

const GO = process.argv.includes('--go');
const ALL = process.argv.includes('--all');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const TABLE = 'agency_forecasts';

async function hasColumn(): Promise<boolean> {
  const { error } = await db.from(TABLE).select('map_lat').limit(1);
  return !error;
}

// resolvePinCoord keys precision off whether it found a city/ZIP vs a state centroid — but it
// returns source as 'pop'/'office', not 'city'/'state'. We re-derive precision here: a real
// city match means g.city is non-empty AND matched (source pop/office with a city). Simpler:
// call resolvePinCoord, then check if the row had a placeable city — if the coord came from a
// centroid, city will be '' (geocode returns city:'' on the centroid fallback path).
function precisionOf(city: string): 'city' | 'state' {
  return city && city.trim() ? 'city' : 'state';
}

interface Row { id: string; title: string | null; pop_city: string | null; pop_state: string | null; pop_zip: string | null; pop_country: string | null; }

async function main() {
  if (!(await hasColumn())) {
    console.log('⚠️  map_lat column not found — run supabase/migrations/20260731_forecast_map_latlng.sql first.');
    if (GO) process.exit(1);
    return;
  }

  const countQ = db.from(TABLE).select('id', { count: 'exact', head: true });
  const { count: remaining } = ALL ? await countQ : await countQ.is('map_lat', null);
  console.log(`agency_forecasts rows to process: ${remaining ?? 'unknown'}${ALL ? ' (--all)' : ' (map_lat IS NULL)'}`);

  const SELECT = 'id, title, pop_city, pop_state, pop_zip, pop_country';

  if (!GO) {
    const { data } = await db.from(TABLE).select(SELECT).is('map_lat', null).limit(6);
    console.log('\nSample resolution:');
    let placed = 0, unmapped = 0;
    for (const r of (data || []) as Row[]) {
      const g = resolvePinCoord({ notice_id: r.id, title: r.title, pop_city: r.pop_city, pop_state: r.pop_state, pop_zip: r.pop_zip, pop_country: r.pop_country });
      if (!g) { unmapped++; console.log(`  ${(r.title||'').slice(0,34)} → (no resolvable state)`); continue; }
      placed++;
      console.log(`  ${(r.title||'').slice(0,34)} → ${g.city || g.state} [${g.lat.toFixed(3)}, ${g.lng.toFixed(3)}] (${precisionOf(g.city)})`);
    }
    if (unmapped) console.log(`  (${unmapped} of the sample had no resolvable state → stays NULL)`);
    console.log('\nDRY RUN. Re-run with --go to write.');
    return;
  }

  let processed = 0, mapped = 0, skipped = 0, from = 0;
  const PAGE = 1000;
  for (;;) {
    let sel = db.from(TABLE).select(SELECT);
    if (!ALL) sel = sel.is('map_lat', null);
    const { data, error } = await sel.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as Row[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const g = resolvePinCoord({ notice_id: r.id, title: r.title, pop_city: r.pop_city, pop_state: r.pop_state, pop_zip: r.pop_zip, pop_country: r.pop_country });
      if (!g) { skipped++; continue; }
      const { error: upErr } = await db.from(TABLE)
        .update({ map_lat: g.lat, map_lng: g.lng, map_loc_source: precisionOf(g.city) })
        .eq('id', r.id);
      if (upErr) { console.error(`  ✗ ${r.id}: ${upErr.message}`); continue; }
      mapped++;
    }
    processed += rows.length;
    console.log(`  ${processed} processed (${mapped} mapped, ${skipped} no-state)`);
    if (ALL) from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`\n✅ Done. ${mapped} forecasts given coords, ${skipped} left NULL (no resolvable state).`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
