/**
 * Server-verified identity for the /mcp console's own APIs (account, autorecharge).
 *
 * SAME resolution as /api/mcp/session: derive the email ONLY from the signed MI 2FA
 * token (email baked into the signature) or a Supabase session — NEVER from a
 * client-claimed `?email=`. This is what the console already trusts for "who am I",
 * so the account/usage/autorecharge reads must use it too. (requireUserAuth needs a
 * client-supplied email and 401s a plain GET — which silently hid the usage panel.)
 */
import type { NextRequest } from 'next/server';
import { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { verifyUserSession } from '@/lib/api-auth';

/** The signed-in email, or null if the request carries no valid session. */
export async function resolveMcpEmail(request: NextRequest): Promise<string | null> {
  const tfa = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request));
  if (tfa.valid && tfa.email) return tfa.email.toLowerCase();
  const supa = await verifyUserSession(request);
  if (supa.authenticated && supa.email) return supa.email.toLowerCase();
  return null;
}
