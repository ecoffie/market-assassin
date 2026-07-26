/**
 * /api/cron/build-discover-panels — rebuild the two Mindy landing "Discover" panels
 * (NAICS Leaderboard + Underserved markets) from live USASpending into discover_panel_cache.
 *
 * Dispatcher-fired (cron_jobs 'build-discover-panels', NOT vercel.json). The page reads
 * cheap from Supabase; this cron is the only thing that hits USASpending. Every figure is
 * grounded (3-FY contract spend, real FY-over-FY rank movement, real recipient concentration).
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildMarketPanels } from '@/lib/discover/market-panels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const counts = await buildMarketPanels();
    return NextResponse.json({ success: true, ...counts });
  } catch (e) {
    console.error('[build-discover-panels] failed:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
