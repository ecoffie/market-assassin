import { NextRequest, NextResponse } from 'next/server';
import { postSignupPath } from '@/lib/mindy/post-signup-destination';

/**
 * Preserve OAuth callback URLs while letting the browser Supabase client
 * exchange the code and persist the session.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  // ⚠️ THIS LINE IS THE REPORTED BUG (2026-08-25). It read:
  //     searchParams.get('next') || '/app/onboarding'
  // so a generic referral — which carries no intent — landed every new account in the
  // legacy profile builder we are retiring. The fallback WAS the legacy surface.
  //
  // One shared resolver now owns the decision for every entry path: a safe Maps `next`
  // wins, explicit MCP/purchase intent routes accordingly, and anything unknown goes to
  // /welcome. It also rejects a `next` that points BACK at /app or /briefings, so a stale
  // link cannot reintroduce the old experience.
  const next = postSignupPath({
    next: requestUrl.searchParams.get('next'),
    intent: requestUrl.searchParams.get('intent'),
    purchaseNext: requestUrl.searchParams.get('purchase_next'),
  });
  const redirectUrl = new URL(next, request.url);

  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'next') {
      redirectUrl.searchParams.set(key, value);
    }
  });

  return NextResponse.redirect(redirectUrl);
}
