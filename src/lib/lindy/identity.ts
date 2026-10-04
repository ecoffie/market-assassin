/**
 * Who a Lindy / automation request is FOR.
 *
 * The /api/lindy/* routes return a user's own briefings, profile and matches, so the
 * identity must be proven — never taken from a ?email= / body email. Two proofs:
 *   - a verified session (Mindy session or Supabase session), for a signed-in browser;
 *   - a Mindy API key issued with the `briefings:read` scope, for an automation
 *     (Lindy, Zapier, Make, n8n). An MCP key is refused here, and this key is refused
 *     on the MCP edge (see keyAllows in src/lib/mcp/api-keys.ts).
 * A claimed email is optional and, when present, must equal the proven identity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyClaimedIdentity } from '@/lib/api-auth';
import { verifyApiKey, BRIEFINGS_READ_SCOPE } from '@/lib/mcp/api-keys';

export type LindyIdentity =
  | { ok: true; email: string; method: 'session' | 'api_key' }
  | { ok: false; response: NextResponse };

function refuse(error: string): LindyIdentity {
  return { ok: false, response: NextResponse.json({ error, auth_required: true }, { status: 401 }) };
}

function presentedKey(request: NextRequest): string | null {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return bearer || request.headers.get('x-mindy-api-key')?.trim() || null;
}

export async function resolveLindyIdentity(request: NextRequest, claimedEmail?: string | null): Promise<LindyIdentity> {
  const claimed = claimedEmail?.toLowerCase().trim() || null;

  const session = await verifyClaimedIdentity(request, claimed);
  if (session.status === 'verified') return { ok: true, email: session.email, method: 'session' };
  if (session.status === 'mismatch') return refuse('Email mismatch with session');

  const key = await verifyApiKey(presentedKey(request), BRIEFINGS_READ_SCOPE);
  if (key) {
    const owner = key.userEmail.toLowerCase();
    if (claimed && claimed !== owner) return refuse('Email mismatch with API key');
    return { ok: true, email: owner, method: 'api_key' };
  }

  return refuse('Sign in, or send a Mindy connection key (Authorization: Bearer <key>)');
}
