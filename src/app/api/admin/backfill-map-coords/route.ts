/**
 * /api/admin/backfill-map-coords — stamp map_lat/map_lng on sam_opportunities so the
 * Opportunity Map explorer can query by viewport (bbox) instead of geocoding in memory.
 *
 * Uses the SAME resolvePinCoord() the map draws with (pop city → pop ZIP → office ZIP →
 * office city → state centroid), deterministic per notice_id. Keyset-paginated on
 * notice_id so un-geocodable rows (left NULL, honest) don't block the sweep or get
 * rescanned forever.
 *
 * GET  ?password=            → progress (total, geocoded, remaining) — preview, safe.
 * POST ?password=&mode=execute[&budgetMs=50000][&after=<cursor>][&activeOnly=1]
 *      → sweep a budgeted slice; returns { processed, updated, nextCursor, done }.
 *      Call repeatedly (or via cron) until done:true.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolvePinCoord } from '@/lib/opportunities/map-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
}
function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const ROW_COLS = 'notice_id, title, pop_city, pop_state, pop_zip, office_address';

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sb();
  const now = new Date().toISOString();
  const [{ count: total }, { count: geocoded }, { count: activeTotal }, { count: activeGeo }] = await Promise.all([
    db.from('sam_opportunities').select('id', { count: 'exact', head: true }),
    db.from('sam_opportunities').select('id', { count: 'exact', head: true }).not('map_lat', 'is', null),
    db.from('sam_opportunities').select('id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', now),
    db.from('sam_opportunities').select('id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', now).not('map_lat', 'is', null),
  ]);
  return NextResponse.json({
    success: true,
    total, geocoded, remaining: (total ?? 0) - (geocoded ?? 0),
    active: { total: activeTotal, geocoded: activeGeo, remaining: (activeTotal ?? 0) - (activeGeo ?? 0) },
  });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if ((sp.get('mode') || 'preview') !== 'execute') {
    return NextResponse.json({ success: false, message: 'add &mode=execute to run' });
  }
  const budgetMs = Math.min(Number(sp.get('budgetMs') || 50000), 240000);
  const activeOnly = sp.get('activeOnly') === '1';
  const db = sb();
  const now = new Date().toISOString();
  const deadline = Date.now() + budgetMs;

  let cursor = sp.get('after') || '';
  let processed = 0, updated = 0, done = false;

  while (Date.now() < deadline) {
    // Pure keyset page over notice_id (NOT filtered on map_lat IS NULL) so the cursor always
    // advances and the sweep terminates — un-geocodable rows stay NULL but can't trap the loop.
    // Idempotent: re-stamping an already-placed row writes the same deterministic value.
    let q = db.from('sam_opportunities').select(ROW_COLS)
      .order('notice_id', { ascending: true })
      .limit(1000);
    if (activeOnly) q = q.eq('active', true).gt('response_deadline', now);
    if (cursor) q = q.gt('notice_id', cursor);
    const { data, error } = await q;
    if (error) return NextResponse.json({ success: false, error: error.message, processed, updated, nextCursor: cursor }, { status: 500 });
    if (!data || data.length === 0) { done = true; break; }

    const updates: { notice_id: string; lat: number; lng: number }[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      cursor = String(r.notice_id);
      processed++;
      const c = resolvePinCoord(r as Parameters<typeof resolvePinCoord>[0]);
      if (c) updates.push({ notice_id: String(r.notice_id), lat: c.lat, lng: c.lng });
    }
    // Write coords one UPDATE per row (only the placeable ones). Un-geocodable rows stay
    // NULL — but the cursor moved past them, so the sweep still terminates.
    for (const u of updates) {
      const { error: uerr } = await db.from('sam_opportunities')
        .update({ map_lat: u.lat, map_lng: u.lng }).eq('notice_id', u.notice_id);
      if (uerr) return NextResponse.json({ success: false, error: uerr.message, processed, updated, nextCursor: cursor }, { status: 500 });
      updated++;
    }
    if (data.length < 1000) { done = true; break; }
  }

  return NextResponse.json({ success: true, processed, updated, nextCursor: cursor, done });
}
