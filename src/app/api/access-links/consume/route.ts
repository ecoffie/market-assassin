import { NextRequest, NextResponse } from 'next/server';
import { consumeAccessLink } from '@/lib/access-links';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json() as { token?: string };
    if (!token) {
      return NextResponse.json({ success: false, error: 'Token is required' }, { status: 400 });
    }

    const payload = await consumeAccessLink(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'This secure link is invalid or has expired.' }, { status: 404 });
    }

    const emailParam = encodeURIComponent(payload.email);
    const redirectTo =
      payload.destination === 'briefings'
        ? (payload.returnTo || `/app?email=${emailParam}`)
        : `/alerts/preferences?email=${emailParam}`;

    // R1 migration (2026-10-03): a consumed briefings link is proof the reader controls this
    // mailbox (emailed to it, one-time, 15-minute TTL, consumed atomically). That is the verified
    // identity legacy /briefings readers were missing — they relied on the plaintext
    // ma_access_email cookie. Mint the signed Mindy session here so /briefings authenticates from
    // it. The session names the LINK's email, never anything the request body claims.
    const sessionToken = payload.destination === 'briefings' ? createMIAuthSessionToken(payload.email) : undefined;

    return NextResponse.json({
      success: true,
      email: payload.email,
      destination: payload.destination,
      redirectTo,
      ...(sessionToken ? { sessionToken } : {}),
    });
  } catch (error) {
    console.error('[AccessLinks] Consume failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify secure link' }, { status: 500 });
  }
}
