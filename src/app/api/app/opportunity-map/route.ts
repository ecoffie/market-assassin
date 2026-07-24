/**
 * GET /api/app/opportunity-map — live pinned opportunities for the Leaflet Opportunity Map.
 * Public read (same data the Discover surfaces already expose); no PII. Set-aside groups +
 * colors travel with the payload so the client renders the legend/filters without re-deriving.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMapOpportunities, SET_GROUPS } from '@/lib/opportunities/map-data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limit = Math.min(1000, Math.max(50, Number(new URL(request.url).searchParams.get('limit')) || 600));
  try {
    const opps = await getMapOpportunities(limit);
    return NextResponse.json({
      success: true,
      count: opps.length,
      setGroups: SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color })),
      opps,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
