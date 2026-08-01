/**
 * GET /api/app/forecast-map?bbox=west,south,east,north — pins for the Opportunity Map's
 * FORECAST layer (the "coming work" horizon, alongside Open + Recompete). Eric 2026-07-30.
 *
 * Forecasts (agency_forecasts, ~10k rows) are UPCOMING procurements 6–18mo out — no solicitation
 * to bid yet, so the pin carries the estimated ceiling + "anticipated Q<n> FY<yr>" timing, no
 * "View sol". Reads the persisted map_lat/map_lng (backfill-forecast-latlng.ts fills them via the
 * shared resolvePinCoord — same geocode chain as SAM opps), bbox-filtered in SQL like SAM/DIBBS.
 *
 * Mirrors recompete-map's response contract exactly so the client's toRow renders it with no
 * branching: { success, mode, totalForFilters, totalInView, capped, pins }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getForecastViewportPins } from '@/lib/opportunities/map-data';
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
  // Search + filters — previously IGNORED here, so a search flooded the merged map with unfiltered
  // forecasts (Eric 2026-08-01). Thread them into the pins query + the headline count.
  const filters = {
    q: p.get('q'), naics: p.get('naics'), agency: p.get('agency'), state: p.get('state'),
  };

  try {
    const pins = await getForecastViewportPins({ west, south, east, north }, MAX_PINS, filters);
    // totalForFilters — the mappable forecast corpus matching the FILTERS (has coords), no bbox, for
    // the headline. Bind + check error (silent-failure gate): a failed count must not read as 0.
    // Best-effort — a count error shouldn't drop the pins, so on error fall back to the in-view count.
    let totalForFilters = pins.length;
    let cq = sb()
      .from('agency_forecasts')
      .select('id', { count: 'exact', head: true })
      .not('map_lat', 'is', null);
    if (filters.q) { const esc = filters.q.trim().replace(/[%,()]/g, ' '); cq = cq.or(`title.ilike.%${esc}%,naics_code.ilike.%${esc}%,naics_description.ilike.%${esc}%,department.ilike.%${esc}%`); }
    if (filters.naics) { const codes = filters.naics.split(',').map((c) => c.trim()).filter(Boolean); if (codes.length) cq = cq.or(codes.map((c) => (c.length >= 6 ? `naics_code.eq.${c}` : `naics_code.like.${c}%`)).join(',')); }
    if (filters.agency) cq = cq.ilike('department', `%${filters.agency.trim()}%`);
    if (filters.state) cq = cq.eq('pop_state', filters.state.trim().toUpperCase());
    const { count, error: countErr } = await cq;
    if (countErr) {
      console.error('[forecast-map] totalForFilters count failed:', countErr.message);
    } else if (count != null) {
      totalForFilters = count;
    }

    return NextResponse.json({
      success: true,
      mode: 'forecast',
      totalForFilters,
      totalInView: pins.length,
      capped: pins.length >= MAX_PINS,
      pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
