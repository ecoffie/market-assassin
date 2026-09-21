/**
 * GET /api/today/your-market — the MOMENTUM half of /today, for the signed-in caller.
 *
 * ⚠️ THE STATE MACHINE LIVES HERE (see `docs/today-page-states.md`). The response's `state`
 * field is what the page renders against, and the three states are NOT interchangeable:
 *
 *   no token        → state 'anonymous'  → the page shows Explore by Market (discovery)
 *   expired token   → state 'expired'    → the page shows Recovery — "welcome back", NOT the
 *                                          first-visit tiles. A user with a year of pursuits
 *                                          must never be told they are new.
 *   valid token     → state 'authenticated' → Your Market (momentum)
 *
 * ⚠️ THE STATE IS DERIVED FROM THE TOKEN, NEVER FROM A DECODED EMAIL. Those answer two
 * different questions — "can we trust this session?" vs "do we know who this is?" — and
 * conflating them is a bug this repo has already shipped once: `_uemail()` decodes the wrong
 * JWT segment and returns '' for genuinely signed-in users, so an email-gated check showed a
 * logged-in person the sign-in shell (`opportunity-map/route.ts:5399`; Eric: "this says sign
 * in but we are already logged in").
 *
 * The email is resolved SERVER-side from the signed token. A client-supplied `?email=` is
 * ignored — it would let anyone read anyone's pursuits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { verifyUserSession } from '@/lib/api-auth';
import { getYourMarket } from '@/lib/today/your-market';

export const dynamic = 'force-dynamic';

export type TodayState = 'anonymous' | 'expired' | 'authenticated';

export async function GET(request: NextRequest) {
  const raw = getTwoFactorTokenFromRequest(request);

  // No credential at all = a genuine first-time visitor.
  if (!raw) {
    const supa = await verifyUserSession(request);
    if (!supa.authenticated || !supa.email) {
      return NextResponse.json({ state: 'anonymous' as TodayState }, { headers: NO_STORE });
    }
    return respondAuthenticated(supa.email.toLowerCase());
  }

  const tfa = verifyTwoFactorSessionToken(raw);
  if (tfa.valid && tfa.email) return respondAuthenticated(tfa.email.toLowerCase());

  // A token that FAILED verification is not the same as no token. Only a genuine expiry earns
  // the "welcome back" recovery copy — a malformed or tampered token gets the anonymous path,
  // because we cannot honestly claim to know them.
  const expired = tfa.error === 'Two-factor session expired';
  return NextResponse.json(
    { state: (expired ? 'expired' : 'anonymous') as TodayState },
    { headers: NO_STORE },
  );
}

const NO_STORE = { 'cache-control': 'no-store' } as const;

async function respondAuthenticated(email: string) {
  try {
    const data = await getYourMarket(email);
    return NextResponse.json({ state: 'authenticated' as TodayState, ...data }, { headers: NO_STORE });
  } catch (err) {
    // A failure here must not blank the page: the client falls back to Explore by Market per
    // the hierarchy in docs/today-page-states.md rather than rendering an empty panel.
    console.error('[your-market] failed:', err);
    return NextResponse.json(
      { state: 'authenticated' as TodayState, degraded: true, recentlyViewed: [], pursuits: [], recommended: [], sinceLastVisit: null, lastVisitAt: null },
      { headers: NO_STORE },
    );
  }
}
