#!/usr/bin/env npx tsx
/**
 * Backfill dibbs_rfqs.map_lat / map_lng / map_office / map_loc from each row's DoDAAC
 * prefix, so the open-map route can VIEWPORT-query DIBBS in SQL (bbox before limit) like
 * sam_opportunities — instead of the old global-top-400 + JS-filter that hid most open
 * DLA bids. (Eric 2026-07-30 — "everything on the map so people can find + bid".)
 *
 * PURE LOOKUP, no API: reuses the shared resolveDibbsLocation() (src/lib/opportunities/
 * map-data.ts), the SAME derivation getDibbsMapPins() uses at read time, so a backfilled
 * row renders identically. NULL lat = DoDAAC not in the location map → LEFT NULL (honest
 * gap; the row just won't pin until its office is added to dla-dodaac-locations.ts).
 *
 * Idempotent + resumable: only touches rows where map_lat IS NULL. Re-run anytime.
 * Migration 20260730_dibbs_map_latlng.sql adds the columns (hand-run first).
 *
 *   npx tsx scripts/backfill-dibbs-latlng.ts          # DRY (counts + sample)
 *   npx tsx scripts/backfill-dibbs-latlng.ts --go     # write
 *   npx tsx scripts/backfill-dibbs-latlng.ts --go --all   # incl. already-mapped (re-derive)
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveDibbsLocation } from '../src/lib/opportunities/map-data';

const GO = process.argv.includes('--go');
const ALL = process.argv.includes('--all');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const TABLE = 'dibbs_rfqs';

async function hasColumn(): Promise<boolean> {
  const { error } = await db.from(TABLE).select('map_lat').limit(1);
  return !error;
}

async function main() {
  if (!(await hasColumn())) {
    console.log('⚠️  map_lat column not found — run supabase/migrations/20260730_dibbs_map_latlng.sql first.');
    if (GO) process.exit(1);
    return;
  }

  const countQ = db.from(TABLE).select('solicitation_number', { count: 'exact', head: true });
  const { count: remaining } = ALL ? await countQ : await countQ.is('map_lat', null);
  console.log(`dibbs_rfqs rows to process: ${remaining ?? 'unknown'}${ALL ? ' (--all)' : ' (map_lat IS NULL)'}`);

  // DRY sample: show what a few would resolve to.
  if (!GO) {
    const { data } = await db.from(TABLE).select('solicitation_number').is('map_lat', null).limit(6);
    console.log('\nSample resolution:');
    let unmapped = 0;
    for (const r of data || []) {
      const loc = resolveDibbsLocation(r.solicitation_number as string);
      if (!loc) { unmapped++; console.log(`  ${r.solicitation_number} → (no office mapping)`); continue; }
      console.log(`  ${r.solicitation_number} → ${loc.map_loc} (${loc.map_office}) [${loc.map_lat.toFixed(3)}, ${loc.map_lng.toFixed(3)}]`);
    }
    if (unmapped) console.log(`  (${unmapped} of the sample had no office mapping — those stay NULL)`);
    console.log('\nDRY RUN. Re-run with --go to write.');
    return;
  }

  // Page through in chunks (PostgREST caps a select at 1000).
  let processed = 0, mapped = 0, skipped = 0, from = 0;
  const PAGE = 1000;
  for (;;) {
    let sel = db.from(TABLE).select('solicitation_number');
    if (!ALL) sel = sel.is('map_lat', null);
    const { data, error } = await sel.order('solicitation_number', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) break;

    // Build per-row updates. Group by identical (lat,lng,office,loc)? No — each sol has a
    // unique jitter, so update per row. Batch the writes with individual updates (small set).
    for (const r of rows) {
      const sol = r.solicitation_number as string;
      const loc = resolveDibbsLocation(sol);
      if (!loc) { skipped++; continue; } // unmapped office → leave NULL (honest gap)
      const { error: upErr } = await db.from(TABLE)
        .update({ map_lat: loc.map_lat, map_lng: loc.map_lng, map_office: loc.map_office, map_loc: loc.map_loc })
        .eq('solicitation_number', sol);
      if (upErr) { console.error(`  ✗ ${sol}: ${upErr.message}`); continue; }
      mapped++;
    }
    processed += rows.length;
    console.log(`  ${processed} processed (${mapped} mapped, ${skipped} unmapped-office)`);
    // When filtering map_lat IS NULL, mapped rows drop out of the filter → don't advance `from`
    // (the next page's head is fresh unprocessed rows). With --all we page normally.
    if (ALL) from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`\n✅ Done. ${mapped} rows given coords, ${skipped} left NULL (no office mapping).`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
