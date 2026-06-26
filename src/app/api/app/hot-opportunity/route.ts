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

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** The viewer's saved NAICS codes. The hot-SS card is social proof for ENGAGED
 *  members — with NO market set up there's nothing to be relevant to. Empty → hide
 *  the card (Eric, Jun 25). On error → empty (better to hide than mislead). */
async function getViewerNaics(email: string): Promise<string[]> {
  try {
    const { data } = await sb()
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', email)
      .maybeSingle();
    const codes = data?.naics_codes;
    return Array.isArray(codes) ? (codes as string[]).map((c) => String(c).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** notice_id → NAICS for a set of notices (from the opportunity cache). Lets us
 *  judge whether a hot opp is in the viewer's space. */
async function naicsForNotices(noticeIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!noticeIds.length) return map;
  try {
    const { data } = await sb()
      .from('sam_opportunities')
      .select('notice_id, naics_code')
      .in('notice_id', noticeIds);
    for (const r of (data || []) as Array<{ notice_id?: string; naics_code?: string }>) {
      if (r.notice_id && r.naics_code) map.set(r.notice_id, String(r.naics_code).trim());
    }
  } catch { /* fall through — unknown NAICS treated as non-match */ }
  return map;
}

/** Industry-level relevance: the opp's NAICS shares its first 4 digits (industry)
 *  with one of the viewer's codes, or matches exactly. Keeps the hot card to the
 *  viewer's space instead of a global "most-tracked" opp shown to everyone (Eric,
 *  Jun 26: "why does it show the hot SS on every profile… that logic doesn't make
 *  sense"). */
function naicsRelevant(oppNaics: string | undefined, userCodes: string[]): boolean {
  if (!oppNaics) return false;
  const opp4 = oppNaics.slice(0, 4);
  return userCodes.some((c) => c === oppNaics || c.slice(0, 4) === opp4);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // PROFILE GATE. No saved NAICS profile → no market yet → don't pretend a hot
  // opportunity is relevant to this user. Applies to the demo card too.
  const userNaics = await getViewerNaics(email);
  if (userNaics.length === 0) {
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

    // PERSONALIZE. Only surface a hot opp that's in the VIEWER'S space — match the
    // opp's NAICS (from the cache) to the user's codes. A global "most-tracked" opp
    // shown to everyone regardless of industry was the nonsense Eric flagged. Opps
    // with unknown NAICS are excluded (can't prove relevance → don't mislead).
    const naicsMap = await naicsForNotices(ready.map((o) => o.noticeId));
    const relevant = ready.filter((o) => naicsRelevant(naicsMap.get(o.noticeId), userNaics));
    if (!relevant.length) {
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Pick the hottest of the RELEVANT opps: prefer Sources Sought (the "respond
    // together" sweet spot), then by tracker count (already sorted desc).
    const hot =
      relevant.find((o) => o.isSourcesSought) ?? relevant[0];

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
