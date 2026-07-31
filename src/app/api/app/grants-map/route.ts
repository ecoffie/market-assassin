/**
 * GET /api/app/grants-map?bbox=west,south,east,north — pins for the Opportunity Map's GRANTS
 * layer (federal funding you can APPLY for, alongside Open + Forecast + Recompete). Eric 2026-07-31.
 *
 * Grants (grants_cache, filled by scripts/ingest-grants.ts from Grants.gov) have NO place of
 * performance, so each is pinned at its AWARDING DEPARTMENT's HQ — honestly flagged "agency HQ ·
 * approximate". Reads the persisted map_lat/map_lng, bbox-filtered in SQL like SAM/DIBBS/forecasts.
 *
 * Mirrors forecast-map's response contract exactly so the client's toRow renders it with no
 * branching: { success, mode, totalForFilters, totalInView, capped, pins }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGrantsViewportPins } from '@/lib/opportunities/map-data';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const bboxRaw = p.get('bbox');
  if (!bboxRaw) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;

  try {
    const pins = await getGrantsViewportPins({ west, south, east, north }, MAX_PINS);
    // totalForFilters — the whole mappable, still-open grant corpus (has coords), no bbox, for the
    // headline. Bind + check error (silent-failure gate): a failed count must not read as 0 grants.
    // Best-effort — on a count error, fall back to the in-view count, never a fabricated 0.
    let totalForFilters = pins.length;
    const todayIso = new Date().toISOString().slice(0, 10);
    const { count, error: countErr } = await sb()
      .from('grants_cache')
      .select('opp_number', { count: 'exact', head: true })
      .not('map_lat', 'is', null)
      .or(`close_date.gte.${todayIso},close_date.is.null,status.eq.forecasted`);
    if (countErr) {
      console.error('[grants-map] totalForFilters count failed:', countErr.message);
    } else if (count != null) {
      totalForFilters = count;
    }

    return NextResponse.json({
      success: true,
      mode: 'grants',
      totalForFilters,
      totalInView: pins.length,
      capped: pins.length >= MAX_PINS,
      pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
