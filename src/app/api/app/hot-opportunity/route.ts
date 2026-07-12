/**
 * Best Fit For You — the single best-matched OPEN opportunity for the active
 * profile, for the in-app "⭐ Best fit for you" hero card.
 *
 * This replaced the old "most-tracked across Mindy" card (July 2026). That card
 * drew from what OTHER users were tracking (getDemandHeatmap → user_pipeline),
 * whose deadlines were ~93% expired — so it structurally showed stale/irrelevant
 * opps and often nothing. The best-fit card instead draws from the SAME live,
 * open, profile-matched pool the Source Feed uses (/api/app/opportunities), ranks
 * by match STRENGTH (distinctive keyword / PSC / NAICS), and returns ONE opp with
 * a concrete reason it fits. Tracker count (how many contractors track it) is kept
 * as a secondary social-proof garnish when present — not the basis for selection.
 *
 *   GET ?email=<user> -> { hot: { noticeId, title, agency, trackerCount,
 *                                 isSourcesSought, responseDeadline, matchReason,
 *                                 message } | null }
 *
 * Coach Mode: matches against the ACTIVE workspace's profile (client's synthetic
 * notification email) so a coach working a client sees the CLIENT's best fit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { isDistinctiveKeyword } from '@/lib/market/keyword-sanitize';
import { naicsSubsectorPrefixes } from '@/lib/utils/naics-expansion';
import { hasRunway, runwayRank } from '@/lib/opportunities/runway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface ViewerProfile {
  naics: string[];
  keywords: string[];
  psc: string[];
}

/** The active profile (NAICS + keywords + PSC). Empty NAICS AND empty keywords →
 *  no market yet → the card hides (nothing to be relevant to). */
async function getViewerProfile(profileEmail: string): Promise<ViewerProfile> {
  try {
    const { data } = await sb()
      .from('user_notification_settings')
      .select('naics_codes, keywords, psc_codes')
      .eq('user_email', profileEmail)
      .maybeSingle();
    const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map((c) => String(c).trim()).filter(Boolean) : []);
    return {
      naics: arr(data?.naics_codes),
      keywords: arr(data?.keywords).map((k) => k.toLowerCase()),
      psc: arr(data?.psc_codes).map((p) => p.toUpperCase()),
    };
  } catch {
    return { naics: [], keywords: [], psc: [] };
  }
}

type OppRow = {
  notice_id: string;
  title: string | null;
  naics_code: string | null;
  psc_code: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  notice_type: string | null;
  response_deadline: string | null;
};

/**
 * Score how STRONGLY an open opp matches the profile, and WHY. A lone GENERIC
 * keyword ("management") is NOT a strong signal (it floods) — only a DISTINCTIVE
 * keyword (phrase / specific term), a PSC family hit, or NAICS-backed-by-a-keyword
 * qualifies. Returns { score, reason }; score 0 = not this viewer's opp.
 */
function scoreOpp(opp: OppRow, p: ViewerProfile): { matchScore: number; rankScore: number; reason: string } {
  const title = (opp.title || '').toLowerCase();
  const naics = opp.naics_code ? String(opp.naics_code).trim() : '';
  const psc = opp.psc_code ? String(opp.psc_code).trim().toUpperCase() : '';

  const distinctiveHits = p.keywords.filter((k) => isDistinctiveKeyword(k) && title.includes(k));
  const anyKwHit = p.keywords.some((k) => title.includes(k));
  const naicsHit = !!naics && p.naics.some((c) => c === naics || c.slice(0, 4) === naics.slice(0, 4));
  const pscHit = !!psc && p.psc.some((c) => c === psc || c.slice(0, 2) === psc.slice(0, 2));

  // MATCH score = relevance strength ONLY. This is what the strong-match bar tests,
  // so freshness can never push a weak match over it (a NAICS-only 20 stays 20).
  let matchScore = 0;
  const reasons: string[] = [];
  if (distinctiveHits.length) { matchScore += distinctiveHits.length * 40; reasons.push(`matches "${distinctiveHits[0]}"`); }
  if (pscHit) { matchScore += 25; reasons.push(`PSC ${psc}`); }
  if (naicsHit && anyKwHit) { matchScore += 20; reasons.push(`NAICS ${naics}`); }

  // RANK score = match + a small sooner-deadline nudge (tiebreaker among matches of
  // equal strength). Never affects whether an opp qualifies — only the ordering.
  let rankScore = matchScore;
  if (matchScore > 0 && opp.response_deadline) {
    const days = Math.ceil((new Date(opp.response_deadline).getTime() - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 30) rankScore += 5;
  }
  return { matchScore, rankScore, reason: reasons.join(' · ') };
}

function isSourcesSought(noticeType?: string | null): boolean {
  const t = (noticeType || '').toLowerCase();
  return t.includes('sources sought') || t.includes('source sought') || t === 'ss' || t.includes('rfi') || t.includes('special notice');
}

function buyerAgency(opp: OppRow): string | null {
  return opp.department || opp.sub_tier || opp.office || null;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // Coach Mode: match against the ACTIVE workspace's profile.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const profileEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  const profile = await getViewerProfile(profileEmail);
  // No market set up → nothing to be "best fit" for. (Applies to the demo too.)
  if (profile.naics.length === 0 && profile.keywords.length === 0) {
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // --- DEMO SAFETY NET (YT Live) ----------------------------------------
  // COLLAB_DEMO_TITLE forces a synthetic card so it's guaranteed on screen.
  // Per-request override: ?demo=1 / ?demo=0. Turn OFF (unset env) after a demo.
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
          matchReason: 'matches your profile',
          message: 'Your strongest open match right now — get ahead of it.',
          demo: true,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // ----------------------------------------------------------------------

  try {
    // Pull the OPEN, profile-matched pool — the same shape /api/app/opportunities
    // uses: active + future deadline, filtered to the profile's NAICS subsectors
    // (3-digit prefix) OR its distinctive keywords/PSC in the title.
    // Full now() timestamp, NOT a date-only string. A date-only "midnight today"
    // lets same-day-already-passed opps through — and this is the ONE opp we
    // hold up as "best fit," so an expired best pick is the worst-case trust hit
    // (the very failure the old most-tracked card had, per the header note).
    const nowIso = new Date().toISOString();
    const naicsPrefixes = naicsSubsectorPrefixes(profile.naics);
    const naicsFilters = naicsPrefixes.map((c) => `naics_code.like.${c}%`);
    const distinctive = profile.keywords.filter((k) => isDistinctiveKeyword(k));
    const kwFilters = distinctive.map((k) => `title.ilike.%${k.replace(/[(),*]/g, ' ').trim()}%`);
    const orFilter = [...naicsFilters, ...kwFilters].filter(Boolean).join(',');
    if (!orFilter) {
      // No NAICS and only generic keywords → nothing precise to match on.
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { data: rows } = await sb()
      .from('sam_opportunities')
      .select('notice_id, title, naics_code, psc_code, department, sub_tier, office, notice_type, response_deadline')
      .eq('active', true)
      .or(`response_deadline.gte.${nowIso},response_deadline.is.null`)
      .or(orFilter)
      .order('response_deadline', { ascending: true })
      .limit(400);

    // "Best fit" must mean a GENUINELY strong match, not merely the least-bad of a
    // broad profile. Require a strong signal: a distinctive keyword (40) or a PSC
    // family hit (25). A NAICS-only match (20, backed only by a generic keyword like
    // "management") does NOT clear the bar — that's the weak, vague card the user
    // disliked. Under-bar profiles (Blue Heron's all-generic keywords) get no card +
    // the TargetingCard precision nudge telling them how to earn one.
    // Bar tests MATCH strength only (freshness can't push a weak match over it).
    const MIN_STRONG_SCORE = 25;
    const pool = (rows || []) as OppRow[];
    const scored = pool
      // Runway gate: drop null-deadline rows that aren't respondable (Award /
      // Justification — already awarded, not a real "best fit"). Dated rows are
      // already future-bounded by the query.
      .filter((o) => hasRunway(o.response_deadline, 1, undefined, o.notice_type))
      .map((o) => ({ o, ...scoreOpp(o, profile) }))
      .filter((x) => x.matchScore >= MIN_STRONG_SCORE);
    if (!scored.length) {
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Rank by rankScore (match + freshness), then RUNWAY (real runway beats a
    // 1-day scramble — the single best pick must be pursuable, not a countdown),
    // then soonest deadline within a runway tier, then SS.
    scored.sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      const rr = runwayRank(b.o.response_deadline) - runwayRank(a.o.response_deadline);
      if (rr !== 0) return rr;
      const ad = a.o.response_deadline ? new Date(a.o.response_deadline).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.o.response_deadline ? new Date(b.o.response_deadline).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return Number(isSourcesSought(b.o.notice_type)) - Number(isSourcesSought(a.o.notice_type));
    });
    const best = scored[0];
    const opp = best.o;

    // Social-proof GARNISH: how many contractors track this exact notice (anonymous,
    // excludes the viewer). Secondary — the card leads with fit, not the crowd.
    let trackerCount = 0;
    try {
      const { data: trackers } = await sb()
        .from('user_pipeline')
        .select('user_email')
        .eq('notice_id', opp.notice_id)
        .neq('is_archived', true);
      const others = new Set(
        (trackers || [])
          .map((t: { user_email?: string }) => (t.user_email || '').toLowerCase())
          .filter((u: string) => u && u !== profileEmail && u !== email)
      );
      trackerCount = others.size;
    } catch { /* garnish only — never block the card */ }

    const ss = isSourcesSought(opp.notice_type);
    const message = ss
      ? 'Your strongest open Sources Sought match — respond to get on the agency’s radar.'
      : 'Your strongest open match right now — sharpen your response before it closes.';

    return NextResponse.json(
      {
        hot: {
          noticeId: opp.notice_id,
          title: opp.title,
          agency: buyerAgency(opp),
          trackerCount,
          isSourcesSought: ss,
          responseDeadline: opp.response_deadline,
          matchReason: best.reason,
          message,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
