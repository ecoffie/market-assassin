import { NextRequest, NextResponse } from 'next/server';
import {
  getTwoFactorTokenFromRequest,
  verifyTwoFactorSessionToken,
  createMIAuthSessionToken,
} from '@/lib/two-factor-session';

/**
 * Re-issue a fresh 30-day MI session token from a still-valid one.
 *
 * Why: the MI token has a hard 30-day TTL with no refresh, so active users were
 * silently logged out once a month ("Two-factor session expired" → blank panel).
 * The /app shell calls this proactively when a token is within 7 days of expiry,
 * so a continuously-active user never hits the cliff. A genuinely expired token
 * is rejected (must re-auth via Supabase) — this renews valid sessions, it does
 * not resurrect dead ones.
 *
 * Auth: the current token IS the credential (HMAC-signed, account-bound). No
 * Supabase round-trip needed, so it works even after the Supabase access token
 * has rotated.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getTwoFactorTokenFromRequest(request);
    const result = verifyTwoFactorSessionToken(token);

    if (!result.valid || !result.email) {
      return NextResponse.json(
        { success: false, error: result.error || 'Sign in required' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      email: result.email,
      authenticatedAt: new Date().toISOString(),
      sessionToken: createMIAuthSessionToken(result.email),
    });
  } catch (error) {
    console.error('[MI Session Refresh] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh Mindy session' },
      { status: 500 }
    );
  }
}
