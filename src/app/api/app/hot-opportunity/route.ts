/**
 * Hot Opportunity — the single most-tracked collab-ready opp, for the in-app
 * "🔥 Hot right now" hero card (the social-proof "aha moment").
 *
 * Reuses the Demand Heatmap engine (the same aggregated user-intent signal the
 * admin sees) and returns ONE opp: the most-tracked, collab-ready one, preferring
 * Sources Sought (the "respond together" sweet spot). Anonymous aggregate count
 * only — never names. Gated on COLLAB_THRESHOLD so a weak signal never surfaces.
 *
 * This is system-wide social proof ("N contractors across Mindy are researching
 * this"), so the count is NOT personalized — but the route is still user-authed
 * (it lives under /app and only members should see the signal).
 *
 *   GET ?email=<user> -> { hot: { noticeId, title, agency, trackerCount,
 *                                 isSourcesSought, message } | null }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getDemandHeatmap } from '@/lib/admin/demand-heatmap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  try {
    const heatmap = await getDemandHeatmap(40);
    const ready = heatmap.opps.filter((o) => o.collabReady);
    if (!ready.length) {
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Pick the hottest: prefer Sources Sought (the "respond together" sweet
    // spot), then by tracker count. opps are already sorted by trackerCount desc.
    const hot =
      ready.find((o) => o.isSourcesSought) ?? ready[0];

    const message = hot.isSourcesSought
      ? `${hot.trackerCount} contractors are researching this Sources Sought. You're not the only one — respond together.`
      : `${hot.trackerCount} contractors are tracking this opportunity. You're not the only one pursuing it.`;

    return NextResponse.json(
      {
        hot: {
          noticeId: hot.noticeId,
          title: hot.title,
          agency: hot.agency,
          trackerCount: hot.trackerCount,
          isSourcesSought: hot.isSourcesSought,
          responseDeadline: hot.responseDeadline,
          message,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // Never break the dashboard — just show no card.
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
