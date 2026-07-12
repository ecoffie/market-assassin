/**
 * /api/mcp/session — the server-verified "who am I" for the /mcp console.
 *
 * The console must NOT trust the client-supplied `mi_beta_email` (a plaintext
 * localStorage value that goes stale on account switch and made the dashboard
 * show the WRONG account's zero balance while the credits sat on the real one).
 *
 * This route derives identity ONLY from the cryptographically-signed MI 2FA
 * token (email is baked into the signed payload) or a Supabase session — never
 * from a claimed email, and with NO staff-email bypass. Whatever email this
 * returns is the account the console renders. 401 → show the sign-in gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { verifyUserSession } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 1) MI 2FA token — this is what every /app surface sends (x-mi-auth-token).
  //    Verifying with no expectedEmail returns the email the signature proves.
  const tfa = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request));
  if (tfa.valid && tfa.email) {
    return NextResponse.json({ success: true, email: tfa.email });
  }

  // 2) Supabase session (Authorization: Bearer <access_token>) — fallback for
  //    surfaces that carry a real Supabase token instead of the 2FA token.
  const supa = await verifyUserSession(request);
  if (supa.authenticated && supa.email) {
    return NextResponse.json({ success: true, email: supa.email });
  }

  return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
}
