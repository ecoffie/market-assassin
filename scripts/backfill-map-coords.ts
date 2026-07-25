/**
 * One-time (resumable) backfill of sam_opportunities.map_lat/map_lng using the SAME
 * resolvePinCoord() the Opportunity Map draws with. Shares the geocode chain so stored
 * coords agree with the live map. Keyset-paginated over notice_id → terminates cleanly.
 *
 *   npx tsx -r dotenv/config scripts/backfill-map-coords.ts dotenv_config_path=.env.local [--active] [--go]
 *
 * --active  sweep only active biddable rows (verify reconciliation fast) — default: all rows.
 * --go      write. Without it, dry-run (counts only).
 *
 * Reads via Supabase REST (keyset page), writes via a DIRECT pg bulk `UPDATE ... FROM (VALUES)`
 * — partial-column upsert can't be used (the omitted NOT NULL `title` fails the insert branch),
 * and single-row UPDATEs are far too slow (~5/s). One UPDATE per ~1000-row page instead.
 */
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { resolvePinCoord } from '../src/lib/opportunities/map-data';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDatabaseUrl } = require('./lib/db-url.js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ACTIVE = process.argv.includes('--active');
const GO = process.argv.includes('--go');
const COLS = 'notice_id, title, pop_city, pop_state, pop_zip, pop_country, office_address';

async function main() {
  const pg = GO ? new Client({ connectionString: getDatabaseUrl() }) : null;
  if (pg) await pg.connect();

  const now = new Date().toISOString();
  let cursor = '';
  let processed = 0, placed = 0, unplaced = 0, batches = 0;
  const t0 = Date.now();

  for (;;) {
    let q = db.from('sam_opportunities').select(COLS)
      .order('notice_id', { ascending: true }).limit(1000);
    if (ACTIVE) q = q.eq('active', true).gt('response_deadline', now);
    if (cursor) q = q.gt('notice_id', cursor);
    const { data, error } = await q;
    if (error) { console.error('read error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    batches++;

    const rows: { id: string; lat: number; lng: number; src: string }[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      cursor = String(r.notice_id);
      processed++;
      const c = resolvePinCoord(r as Parameters<typeof resolvePinCoord>[0]);
      if (!c) { unplaced++; continue; }
      placed++;
      rows.push({ id: String(r.notice_id), lat: c.lat, lng: c.lng, src: c.source });
    }

    if (pg && rows.length) {
      // Bulk: UPDATE ... FROM (VALUES ($1,$2,$3,$4), ...) — one round-trip per page.
      const vals: string[] = [];
      const params: (string | number)[] = [];
      rows.forEach((r, i) => {
        const b = i * 4;
        vals.push(`($${b + 1}, $${b + 2}::float8, $${b + 3}::float8, $${b + 4})`);
        params.push(r.id, r.lat, r.lng, r.src);
      });
      await pg.query(
        `UPDATE sam_opportunities AS s SET map_lat = v.lat, map_lng = v.lng, map_loc_source = v.src
         FROM (VALUES ${vals.join(',')}) AS v(notice_id, lat, lng, src)
         WHERE s.notice_id = v.notice_id`, params);
    }
    if (batches % 5 === 0) {
      console.log(`  ${processed} processed · ${placed} placed · ${unplaced} unplaced · ${Math.round((Date.now()-t0)/1000)}s`);
    }
    if (data.length < 1000) break;
  }

  if (pg) await pg.end();
  const pct = processed ? Math.round((placed / processed) * 100) : 0;
  console.log(`\n${GO ? 'WROTE' : 'DRY RUN'} — scope=${ACTIVE ? 'active' : 'all'}`);
  console.log(`  processed ${processed} · placed ${placed} (${pct}%) · unplaced ${unplaced} · ${Math.round((Date.now()-t0)/1000)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
