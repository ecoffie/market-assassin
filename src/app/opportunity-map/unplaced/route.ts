/**
 * GET /opportunity-map/unplaced — RETIRED, redirects to /opportunity-map/forecasts.
 *
 * A parallel session shipped an "Unplaced forecasts" list here. It was superseded (Eric 2026-08-02:
 * "the page design is bad plus it is not integrated into anything, it's just a data page") by the
 * redesigned /opportunity-map/forecasts — a map sub-view (same header + rail, new-map light) that
 * browses ALL 33K+ forecasts (placed AND location-less) filterable by NAICS / agency / state / FY /
 * keyword. Forecasts also now surface inline in the map results list, the Market view, and Ask
 * Mindy, so the standalone Unplaced page is no longer the way in. This redirect keeps old links +
 * the search-dropdown "view list" row landing on the new page (query carried through).
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const q = new URL(request.url).searchParams.get('q') || '';
  const dest = new URL('/opportunity-map/forecasts', request.url);
  if (q) dest.searchParams.set('q', q);
  return NextResponse.redirect(dest, 308);
}
