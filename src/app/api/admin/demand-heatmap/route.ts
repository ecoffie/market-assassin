/**
 * Admin Demand Heatmap — the aggregated user-intent signal (collaboration / social-
 * proof "aha" feature, Phase 1). Shows which opportunities the most users track,
 * segmented by socioeconomic status, with a threshold-gated "respond together"
 * collab-alert preview. Admin sees + controls the trigger before automating.
 *   GET /api/admin/demand-heatmap?password=...&limit=40
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { getDemandHeatmap } from '@/lib/admin/demand-heatmap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '40', 10), 200);
  try {
    const heatmap = await getDemandHeatmap(limit);
    return NextResponse.json({ success: true, ...heatmap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'demand heatmap failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
