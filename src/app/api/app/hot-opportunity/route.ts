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
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getDemandHeatmap } from '@/lib/admin/demand-heatmap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Has the viewer saved a real NAICS profile? The hot-SS card is social proof for
 *  ENGAGED members — surfacing it to a brand-new user with NO market set up yet is
 *  nonsensical (Eric, Jun 25: "shows the hot SS on every profile including a new
 *  user who has no NAICS codes"). On error → false (better to hide than to mislead). */
async function viewerHasProfile(email: string): Promise<boolean> {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', email)
      .maybeSingle();
    return Array.isArray(data?.naics_codes) && (data!.naics_codes as string[]).length > 0;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // PROFILE GATE. No saved NAICS profile → no market yet → don't pretend a hot
  // opportunity is relevant to this user. Applies to the demo card too.
  if (!(await viewerHasProfile(email))) {
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // --- DEMO SAFETY NET (YT Live) ----------------------------------------
  // When COLLAB_DEMO_TITLE is set, force-return a synthetic hot opp so the
  // "🔥 Hot right now" card is GUARANTEED on screen, independent of real
  // tracking data. Turn OFF after the demo (unset the env). Real signal
  // resumes automatically. Per-request override: ?demo=1 / ?demo=0.
  const demoParam = request.nextUrl.searchParams.get('demo');
  const demoOn = demoParam === '1' || (demoParam !== '0' && !!process.env.COLLAB_DEMO_TITLE);
  if (demoOn && process.env.COLLAB_DEMO_TITLE) {
    const count = Number(process.env.COLLAB_DEMO_COUNT) || 7;
    const title = process.env.COLLAB_DEMO_TITLE;
    const agency = process.env.COLLAB_DEMO_AGENCY || 'Department of Defense';
    const isSS = /sources sought|sources-sought|\bRFI\b/i.test(title);
    return NextResponse.json(
      {
        hot: {
          noticeId: process.env.COLLAB_DEMO_NOTICE_ID || 'demo-collab',
          title,
          agency,
          trackerCount: count,
          isSourcesSought: isSS,
          responseDeadline: process.env.COLLAB_DEMO_DEADLINE || null,
          message: isSS
            ? `${count} contractors are researching this Sources Sought. You're not the only one — respond together.`
            : `${count} contractors are tracking this opportunity. You're not the only one pursuing it.`,
          demo: true,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // ----------------------------------------------------------------------

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
