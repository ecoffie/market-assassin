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
import { listActiveConnectionsForUser } from '@/lib/mcp/oauth/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function sessionJson(email: string) {
  // Connection labels are additive and fail-open. Missing/unreadable oauth
  // rows must not 500 the identity check or invent a "connected" state.
  let connections: Array<{ clientId: string; clientName: string | null }> = [];
  try {
    const rows = await listActiveConnectionsForUser(email);
    connections = rows.map((r) => ({ clientId: r.clientId, clientName: r.clientName }));
  } catch {
    connections = [];
  }
  return NextResponse.json({ success: true, email, connections });
}

export async function GET(request: NextRequest) {
  // 1) MI HMAC token — header first, then the first-party mi_auth cookie.
  const tfa = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request));
  if (tfa.valid && tfa.email) {
    return sessionJson(tfa.email);
  }

  // 2) Supabase session (Authorization: Bearer <access_token>) — fallback for
  //    surfaces that carry a real Supabase token instead of the 2FA token.
  const supa = await verifyUserSession(request);
  if (supa.authenticated && supa.email) {
    return sessionJson(supa.email);
  }

  return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
}
