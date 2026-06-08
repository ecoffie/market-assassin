/**
 * /api/app/award-detail?id=<generated_internal_id> — the shared award-detail
 * endpoint (#50). Returns the full USASpending Contract Summary for one award:
 * obligated→ceiling, parent IDV, period of performance, recipient detail. Used by
 * Sport/Market Research drill-down (#51) and Proposal Assist grounding (#52).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchAwardDetail } from '@/lib/usaspending/award-detail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Small in-process cache — award detail is stable; avoids re-hitting USASpending
// on repeat opens of the same award in a session.
const _cache = new Map<string, { at: number; detail: unknown }>();
const TTL = 60 * 60 * 1000; // 1h

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id (generated_internal_id) is required' }, { status: 400 });

  const cached = _cache.get(id);
  if (cached && Date.now() - cached.at < TTL) {
    return NextResponse.json({ success: true, cached: true, detail: cached.detail });
  }

  const detail = await fetchAwardDetail(id);
  if (!detail) return NextResponse.json({ success: false, error: 'Award not found on USASpending' }, { status: 404 });

  _cache.set(id, { at: Date.now(), detail });
  return NextResponse.json({ success: true, detail });
}
