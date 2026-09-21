/**
 * GET /api/app/win-probability — the branded M-Win™ score for a single opportunity, for the
 * signed-in user, computed from THEIR real profile (Eric 2026-08-04: "add M-Win to the hero").
 *
 * M-Win is only a real number when it's grounded in the user's actual profile. This route loads
 * the caller's live profile (user_notification_settings → BriefingUserProfile) and runs
 * `calculateWinProbability` — the SAME model `verify:m-scale` guards (perfect-match total = 98,
 * no-profile base = 30, monotonic), so the hero's M-Win equals M-Win everywhere else. It NEVER
 * fabricates a personalized %: no profile / signed-out → `grounded:false` + the base fallback, and
 * the drawer shows "Complete profile to unlock M-Win" instead of a number.
 *
 * Async by design: the drawer fetches this to fill the #mWinTop hero cell independently of the
 * M-Estimate (#mEstTop), so the hero stays instant — M-Estimate never waits on M-Win.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getBriefingProfile } from '@/lib/smart-profile/service';
import { calculateWinProbability } from '@/lib/briefings/win-probability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;

  // The opp fields the win-probability model scores. All optional — the model tolerates missing
  // fields (each factor scores what it can). amount is the M-Estimate median (a real number) when
  // the caller has it; win-prob uses it only for the size-fit factor.
  const opportunity = {
    naicsCode: p.get('naics') || undefined,
    setAside: p.get('setAside') || undefined,
    agency: p.get('agency') || undefined,
    amount: p.get('amount') ? Number(p.get('amount')) : undefined,
    title: p.get('title') || undefined,
  };

  // AUTH FIRST, email DERIVED from the verified token (Eric 2026-08-04 bug: a signed-in user saw
  // "Sign in to see your fit"). We do NOT trust the client's `email` param — the drawer's _uemail()
  // decodes the WRONG JWT segment and can send an empty email, which the old `!email` guard then
  // read as signed-out. requireMIAuthSession validates the x-mi-auth-token and returns the real
  // session email, so a valid token is grounded regardless of what the client sent.
  const authSession = requireMIAuthSession(request);
  if (!authSession.ok) {
    // No / invalid session token → genuinely signed out (the shell shows "Sign in to see your fit").
    return NextResponse.json({ success: true, grounded: false, reason: 'signed_out' });
  }
  const email = String(authSession.session.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ success: true, grounded: false, reason: 'signed_out' });
  }

  try {
    const profile = await getBriefingProfile(email);
    // NO PROFILE → grounded:false. The model returns a base 30, but we do NOT present that as a
    // personalized score — the client shows "Complete profile to unlock M-Win" (Eric's call).
    if (!profile) {
      return NextResponse.json({ success: true, grounded: false, reason: 'no_profile' });
    }

    const result = calculateWinProbability(opportunity, profile);

    // The "Should I Pursue This?" decision card (Eric 2026-08-04) — all GROUNDED, from the SAME
    // win-probability factors, no LLM. Why = the positive factors; Risks = the negative ones;
    // Win factors = the positive factor names. Recommendation is derived from the score tier
    // (the deep AI Bid/No-Bid reasoning stays behind its own button — this is the free preview).
    const factors = result.factors || [];
    const why = factors.filter((f) => f.isPositive && f.points > 0)
      .map((f) => f.description || f.name).slice(0, 4);
    const risks = factors.filter((f) => !f.isPositive)
      .map((f) => f.description || f.name).slice(0, 3);
    const winFactors = factors.filter((f) => f.isPositive && f.points > 0)
      .map((f) => f.name).slice(0, 5);
    // Pursue / Watch / Skip from the score (the tiers the model already computes).
    const recommendation = result.score >= 60 ? 'Pursue' : result.score >= 45 ? 'Watch' : 'Skip';

    return NextResponse.json({
      success: true,
      grounded: true,
      score: result.score,          // 0–100, the branded M-Win number
      tier: result.tier,            // excellent / good / moderate / low / poor
      summary: result.summary,      // one-line why (from the model's own factors)
      // Decision-card pieces (grounded, no LLM) for the "Should I Pursue This?" section:
      recommendation,               // Pursue | Watch | Skip
      why,                          // positive factors → the "Why" column
      risks,                        // negative factors → the "Risks" column
      winFactors,                   // positive factor names → the "Win factors" line
    });
  } catch (e) {
    console.error('[win-probability] failed:', (e as Error).message);
    // Degrade to an honest "no score" — never block the hero, never fake a number.
    return NextResponse.json({ success: true, grounded: false, reason: 'error' });
  }
}
