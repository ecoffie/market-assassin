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
import { getForecastViewportPins, getUnplacedForecastRows, applyForecastFilters } from '@/lib/opportunities/map-data';
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
    // Same filters as the pins (shared applyForecastFilters) so the headline count can't disagree.
    const cq = applyForecastFilters(
      sb().from('agency_forecasts').select('id', { count: 'exact', head: true }).not('map_lat', 'is', null),
      filters,
    );
    const { count, error: countErr } = await cq;
    if (countErr) {
      console.error('[forecast-map] totalForFilters count failed:', countErr.message);
    } else if (count != null) {
      totalForFilters = count;
    }

    // UNPLACED forecasts — the ~43% (14,353) with no coordinate. They can't be pins, but they ARE
    // real upcoming buys, so we surface them in the results LIST when a search/filter is active
    // (Eric 2026-08-02: "see this data as part of their search results without it being spatial").
    // Gated on a real search key (q/naics/agency) — unfiltered would drag all 14k location-less rows
    // onto every pan. Returned as a separate `unplaced` array the client renders list-only (no pin).
    let unplaced: Awaited<ReturnType<typeof getUnplacedForecastRows>> = [];
    let unplacedTotal = 0;
    const hasSearchKey = !!(filters.q || filters.naics || filters.agency);

    // THE MAP-TRUTH CONTRACT — ALWAYS count the matching rows the map cannot draw, even when we
    // don't fetch them for the list. This count is a single head query (no rows), so it is cheap.
    //
    // ⚠️ It used to be computed ONLY under `hasSearchKey && includeUnplaced=1`; otherwise it stayed
    // 0 and the merged pill silently under-reported. Forecast carries 14,939 unmapped rows
    // (measured 2026-09-12), so "0 not shown" on an unfiltered view was simply false. A count we
    // decline to take is UNKNOWN, never zero — and here we can always afford to take it.
    let unmappedForFilters: number | null = null;
    {
      const uq = applyForecastFilters(
        sb().from('agency_forecasts').select('id', { count: 'exact', head: true }).is('map_lat', null),
        filters,
      );
      const { count: uc, error: ucErr } = await uq;
      if (ucErr) console.error('[forecast-map] unmapped count failed:', ucErr.message);
      else unmappedForFilters = uc ?? null;
    }

    // The unplaced ROWS (for the results list) stay gated — unfiltered would drag ~15k
    // location-less rows onto every pan. Only the COUNT above is unconditional.
    if (hasSearchKey && p.get('includeUnplaced') === '1') {
      try {
        unplaced = await getUnplacedForecastRows(150, filters);
        unplacedTotal = unmappedForFilters ?? 0;
      } catch (ue) {
        console.error('[forecast-map] unplaced fetch failed:', (ue as Error).message);
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'forecast',
      totalForFilters,
      totalInView: pins.length,
      capped: pins.length >= MAX_PINS,
      pins,
      unplaced,
      unplacedTotal,
      // Matching rows with no coordinate — the map-truth disclosure. null = UNKNOWN, never 0.
      unmappedForFilters,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
