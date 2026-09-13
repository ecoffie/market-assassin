import { NextRequest, NextResponse } from 'next/server';
import { OAUTH_CALLBACK_PATH } from '@/lib/mindy/oauth-callback';

/**
 * Leftover hits only. Do not send anyone into the /app UI.
 * Forwards query (`code`, `next`, errors) to the universal `/auth/callback`.
 */
export async function GET(request: NextRequest) {
  const dest = new URL(OAUTH_CALLBACK_PATH, request.url);
  request.nextUrl.searchParams.forEach((value, key) => {
    dest.searchParams.set(key, value);
  });
  return NextResponse.redirect(dest);
}
