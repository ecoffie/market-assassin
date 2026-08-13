#!/usr/bin/env npx tsx
/**
 * Backfill sam_opportunities.map_lat / map_lng / map_loc_source so Open pins on the
 * Opportunity Map can be VIEWPORT-queried in SQL (bbox before limit).
 *
 * SAM ingest historically wrote pop_city/state/zip/office_address but NEVER stamped
 * coordinates. The live map then dropped every row with map_lat IS NULL — so Horizons
 * "Open" showed ~1.4K (the accidentally-geocoded remainder) while Market Intel counted
 * ~13K active SAM notices. This script uses the SAME resolvePinCoord() chain the
 * sync now stamps going forward (city → ZIP → state centroid, deterministic jitter).
 *
 * NULL lat = no resolvable state → LEFT NULL (honest; the row stays list-only).
 * Idempotent: default run only touches map_lat IS NULL. `--all` re-derives.
 *
 *   npx tsx scripts/backfill-sam-latlng.ts          # DRY (counts + sample)
 *   npx tsx scripts/backfill-sam-latlng.ts --go     # write
 *   npx tsx scripts/backfill-sam-latlng.ts --go --all
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolvePinCoord } from '../src/lib/opportunities/map-data';

const GO = process.argv.includes('--go');
const ALL = process.argv.includes('--all');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const TABLE = 'sam_opportunities';
const SELECT = 'notice_id, title, pop_city, pop_state, pop_zip, pop_country, office_address, map_lat';

interface Row {
  notice_id: string;
  title: string | null;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  pop_country: string | null;
  office_address: { city?: string; state?: string; zipcode?: string; zip?: string } | null;
  map_lat: number | null;
}

async function hasColumn(): Promise<boolean> {
  const { error } = await db.from(TABLE).select('map_lat').limit(1);
  return !error;
}

async function main() {
  if (!(await hasColumn())) {
    console.log('⚠️  map_lat column not found on sam_opportunities.');
    if (GO) process.exit(1);
    return;
  }

  const countQ = db.from(TABLE).select('notice_id', { count: 'exact', head: true });
  const { count: remaining } = ALL ? await countQ : await countQ.is('map_lat', null);
  console.log(`sam_opportunities rows to process: ${remaining ?? 'unknown'}${ALL ? ' (--all)' : ' (map_lat IS NULL)'}`);

  if (!GO) {
    const { data } = await db.from(TABLE).select(SELECT).is('map_lat', null).limit(8);
    console.log('\nSample resolution:');
    let placed = 0, unmapped = 0;
    for (const r of (data || []) as Row[]) {
      const g = resolvePinCoord({
        notice_id: r.notice_id, title: r.title,
        pop_city: r.pop_city, pop_state: r.pop_state,
        pop_zip: r.pop_zip, pop_country: r.pop_country,
        office_address: r.office_address,
      });
      if (!g) { unmapped++; console.log(`  ${(r.title || '').slice(0, 40)} → (no resolvable state)`); continue; }
      placed++;
      console.log(`  ${(r.title || '').slice(0, 40)} → ${g.city || g.state} [${g.lat.toFixed(3)}, ${g.lng.toFixed(3)}] (${g.source})`);
    }
    if (unmapped) console.log(`  (${unmapped} of the sample had no resolvable state → stays NULL)`);
    console.log('\nDRY RUN. Re-run with --go to write.');
    return;
  }

  // Page by notice_id and ALWAYS advance the offset. Do not filter map_lat IS NULL while
  // paging — unstampable rows would stick at range(0, PAGE) forever (forecast backfill stall).
  let processed = 0, mapped = 0, skipped = 0, already = 0, from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await db.from(TABLE)
      .select(SELECT)
      .order('notice_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as Row[];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!ALL && r.map_lat != null) { already++; continue; }
      const g = resolvePinCoord({
        notice_id: r.notice_id, title: r.title,
        pop_city: r.pop_city, pop_state: r.pop_state,
        pop_zip: r.pop_zip, pop_country: r.pop_country,
        office_address: r.office_address,
      });
      if (!g) { skipped++; continue; }
      const { error: upErr } = await db.from(TABLE)
        .update({ map_lat: g.lat, map_lng: g.lng, map_loc_source: g.source })
        .eq('notice_id', r.notice_id);
      if (upErr) { console.error(`  ✗ ${r.notice_id}: ${upErr.message}`); continue; }
      mapped++;
    }
    processed += rows.length;
    console.log(`  ${processed} scanned (${mapped} mapped, ${skipped} no-state${ALL ? '' : `, ${already} already`})`);
    from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`\n✅ Done. ${mapped} SAM notices given coords, ${skipped} left NULL (no resolvable state)${ALL ? '' : `, ${already} already had coords`}.`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
