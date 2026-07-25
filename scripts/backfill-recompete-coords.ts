/**
 * Backfill recompete_opportunities.map_lat/map_lng for the Opportunity Map "Recompetes" mode,
 * using the SAME resolvePinCoord() the open-opps map uses — from place_of_performance_*.
 *
 *   npx tsx -r dotenv/config scripts/backfill-recompete-coords.ts dotenv_config_path=.env.local [--go]
 */
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { resolvePinCoord } from '../src/lib/opportunities/map-data';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDatabaseUrl } = require('./lib/db-url.js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const GO = process.argv.includes('--go');
const COLS = 'contract_id, incumbent_name, place_of_performance_city, place_of_performance_state, place_of_performance_zip, place_of_performance_country';

async function main() {
  const pg = GO ? new Client({ connectionString: getDatabaseUrl() }) : null;
  if (pg) await pg.connect();
  let cursor = '', processed = 0, placed = 0, unplaced = 0, batches = 0;
  const t0 = Date.now();
  for (;;) {
    let q = db.from('recompete_opportunities').select(COLS).is('quality_flag', null)
      .order('contract_id', { ascending: true }).limit(1000);
    if (cursor) q = q.gt('contract_id', cursor);
    const { data, error } = await q;
    if (error) { console.error('read error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    batches++;
    const rows: { id: string; lat: number; lng: number }[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      cursor = String(r.contract_id);
      processed++;
      const c = resolvePinCoord({
        notice_id: String(r.contract_id), title: String(r.incumbent_name || ''),
        pop_city: r.place_of_performance_city as string, pop_state: r.place_of_performance_state as string,
        pop_zip: r.place_of_performance_zip as string, pop_country: r.place_of_performance_country as string,
        office_address: null,
      });
      if (!c) { unplaced++; continue; }
      placed++;
      rows.push({ id: String(r.contract_id), lat: c.lat, lng: c.lng });
    }
    if (pg && rows.length) {
      const vals: string[] = [], params: (string | number)[] = [];
      rows.forEach((r, i) => { const b = i * 3; vals.push(`($${b + 1}, $${b + 2}::float8, $${b + 3}::float8)`); params.push(r.id, r.lat, r.lng); });
      await pg.query(`UPDATE recompete_opportunities AS s SET map_lat = v.lat, map_lng = v.lng
        FROM (VALUES ${vals.join(',')}) AS v(contract_id, lat, lng) WHERE s.contract_id = v.contract_id`, params);
    }
    if (batches % 10 === 0) console.log(`  ${processed} processed · ${placed} placed · ${Math.round((Date.now()-t0)/1000)}s`);
    if (data.length < 1000) break;
  }
  if (pg) await pg.end();
  console.log(`\n${GO ? 'WROTE' : 'DRY'} — processed ${processed} · placed ${placed} (${processed?Math.round(placed/processed*100):0}%) · unplaced ${unplaced} · ${Math.round((Date.now()-t0)/1000)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
