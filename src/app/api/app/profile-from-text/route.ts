/**
 * /api/app/profile-from-text (#64) — POST { text } → the full extracted profile
 * (industry, NAICS, PSC, keywords, states, set-asides, top agencies) for the
 * Auto-onboarding CONFIRM screen. The user reviews before it's committed. Powered
 * by the shared buildProfileFromText engine (LLM industry label + real-data facts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { verifyUserSession } from '@/lib/api-auth';
import { buildProfileFromText } from '@/lib/market/profile-from-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email : null;

  // Read-only extraction, called from BOTH the in-app flow (user has an MI
  // token) AND auto-onboarding (a brand-new OAuth user who only has a Supabase
  // session — the MI token isn't minted until the END of onboarding). Accept
  // EITHER: an MI token, OR a valid Supabase session. Requiring the MI token
  // alone was the "Set me up → Missing two-factor session" onboarding blocker.
  const miCheck = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request), email);
  let authedEmail = miCheck.valid ? miCheck.email : null;
  if (!authedEmail) {
    const supa = await verifyUserSession(request);
    if (supa.authenticated && supa.email && (!email || supa.email === email.toLowerCase().trim())) {
      authedEmail = supa.email;
    }
  }
  if (!authedEmail) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }

  const text = String(body.text || '').trim();
  if (text.length < 4) {
    return NextResponse.json({ success: false, error: 'Tell us a bit about what you do (e.g. "janitorial in Florida").' }, { status: 400 });
  }

  const profile = await buildProfileFromText(text);
  if (!profile || !profile.naics.length) {
    return NextResponse.json({ success: false, error: `Couldn't find a federal market from that. Try naming the service + where you work (e.g. "IT staffing in Texas").` }, { status: 422 });
  }

  return NextResponse.json({ success: true, profile });
}
