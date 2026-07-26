#!/usr/bin/env npx tsx
/**
 * Re-backfill recompete_opportunities.map_lat/map_lng via the shared geocodeCity() for rows
 * that carry a real place_of_performance_city — upgrading them from the state-centroid "ring"
 * (the bug: 500 MO rows cluster around ~9 base points near dead-center Missouri, not St. Louis/
 * KC) to a real city coordinate.
 *
 * ⚠️ MEASURED (2026-07-26): 0 of 143,527 recompete_opportunities rows have
 * place_of_performance_city populated — the column is empty table-wide (confirmed via a direct
 * count, not a sample). There is no `raw_data`/recipient-HQ-city column on this table either.
 * So today this script's DRY run will report 0 recoverable-city rows / ~125,692 state-only rows
 * (rows with a map_lat already stamped, all at state-centroid precision) — the city genuinely
 * needs to be RECOVERED first (a USASpending re-fetch carrying place-of-performance city; see
 * the follow-up note in the opportunity-map spec), which is its own separate, larger job. This
 * script is the re-backfill step that runs AFTER that recovery — kept here, ready, resumable,
 * and safe to re-run as more rows gain a real city.
 *
 *   npx tsx scripts/backfill-recompete-map-latlng.ts            # DRY (counts only)
 *   npx tsx scripts/backfill-recompete-map-latlng.ts --go        # write, default 500
 *   npx tsx scripts/backfill-recompete-map-latlng.ts --go --limit 3000 --concurrency 8
 *
 * Resumable: only touches rows where place_of_performance_city IS present (a future recovery
 * pass fills that column incrementally); rows without a city are left untouched — their stored
 * state-centroid map_lat/map_lng remains the honest fallback, surfaced as locPrecision:'state'
 * at request time by /api/app/recompete-map.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { geocodeCity, stableSeed } from '../src/lib/geo/city-geocode';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
const CONCURRENCY = arg('--concurrency', 8);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { count: totalRows } = await db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true });
  const { count: withCity } = await db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true })
    .not('place_of_performance_city', 'is', null).neq('place_of_performance_city', '');
  const { count: stateOnly } = await db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true })
    .not('map_lat', 'is', null)
    .or('place_of_performance_city.is.null,place_of_performance_city.eq.');

  console.log(`recompete_opportunities total: ${totalRows ?? '?'}`);
  console.log(`  recoverable-city (place_of_performance_city present): ${withCity ?? '?'}`);
  console.log(`  state-only (map_lat set, no city — stays honest state-centroid fallback): ${stateOnly ?? '?'}`);

  if (!withCity) {
    console.log('\nNo rows with a recoverable city. This script has nothing to do until a city-recovery');
    console.log('pass (USASpending re-fetch of place_of_performance_city) fills that column. See the');
    console.log('doc comment at the top of this file — that is a separate, larger job.');
    return;
  }

  if (!GO) {
    // Sample a few recoverable rows + show the before/after geocode for review.
    const { data: sample, error: sampleErr } = await db.from('recompete_opportunities')
      .select('contract_id, incumbent_name, place_of_performance_city, place_of_performance_state, map_lat, map_lng')
      .not('place_of_performance_city', 'is', null).neq('place_of_performance_city', '')
      .limit(5);
    if (sampleErr) throw sampleErr;
    console.log('\nSample (before → after):');
    for (const r of sample || []) {
      const g = geocodeCity(r.place_of_performance_city, r.place_of_performance_state, stableSeed(String(r.contract_id)));
      console.log(`  ${r.incumbent_name} — ${r.place_of_performance_city}, ${r.place_of_performance_state}`);
      console.log(`    before: (${r.map_lat}, ${r.map_lng})  →  after: ${g ? `(${g.lat}, ${g.lng}) [${g.precision}]` : 'no match'}`);
    }
    console.log(`\nDRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to write.`);
    return;
  }

  const { data: rows, error } = await db.from('recompete_opportunities')
    .select('contract_id, place_of_performance_city, place_of_performance_state')
    .not('place_of_performance_city', 'is', null).neq('place_of_performance_city', '')
    .order('contract_id', { ascending: true })
    .limit(LIMIT);
  if (error) throw error;
  const batch = rows || [];
  console.log(`Processing ${batch.length} this run…`);

  let done = 0, upgraded = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const g = geocodeCity(r.place_of_performance_city, r.place_of_performance_state, stableSeed(String(r.contract_id)));
        if (g) {
          await db.from('recompete_opportunities').update({ map_lat: g.lat, map_lng: g.lng }).eq('contract_id', r.contract_id);
          if (g.precision === 'city') upgraded++;
        }
        done++;
        if (done % 100 === 0) console.log(`  ${done}/${batch.length} (${upgraded} upgraded to city precision)`);
      } catch (e) {
        failed++;
        console.error(`  ⏳ ${r.contract_id}: ${e instanceof Error ? e.message : e} (will retry next pass)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ ${done} processed (${upgraded} upgraded to real city precision, ${failed} failed). Re-run to continue.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
