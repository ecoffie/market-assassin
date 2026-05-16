import { NextRequest, NextResponse } from 'next/server';

/**
 * Preserve legacy OAuth callback URLs while letting the browser Supabase client
 * exchange the code and persist the session.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const requestedNext = requestUrl.searchParams.get('next') || '/onboarding';
  const next = requestedNext.startsWith('/') ? requestedNext : '/onboarding';
  const redirectUrl = new URL(next, request.url);

  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'next') {
      redirectUrl.searchParams.set(key, value);
    }
  });

  return NextResponse.redirect(redirectUrl);
}
