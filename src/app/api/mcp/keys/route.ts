/**
 * /api/mcp/keys — self-serve MCP API-key management for the getmindy.ai/mcp dashboard.
 *
 *   POST   → mint a new key (returns the plaintext key ONCE). Body `purpose: 'briefings'`
 *            mints a `briefings:read` connection key (Lindy / automations) instead of
 *            an MCP key; it reads only the owner's briefings and earns no MCP credits.
 *   GET    → list the caller's keys (metadata only, never the secret)
 *   DELETE → revoke one of the caller's keys (?id=<keyId>)
 *
 * Identity comes ONLY from a verified session (the signed Mindy session or a Supabase
 * session). A ?email= / body email is at most a claim that must match it — it never
 * decides whose keys are minted, listed or revoked. This route only manages keys;
 * verifying a presented key on the MCP edge lives in src/lib/mcp/api-keys.ts (Slice 2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyClaimedIdentity, identityFailureResponse, type ClaimedIdentity } from '@/lib/api-auth';
import { issueApiKey, listApiKeys, revokeApiKey, BRIEFINGS_READ_SCOPE } from '@/lib/mcp/api-keys';
import { grantSignupCreditsIfFirst } from '@/lib/mcp/credits';
import { qualifyReferralFromRequest } from '@/lib/mcp/referrals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The key owner: the verified session's email. A claim that contradicts it is refused. */
async function keyOwner(request: NextRequest, bodyEmail?: unknown): Promise<ClaimedIdentity> {
  const claimed = request.nextUrl.searchParams.get('email') || (typeof bodyEmail === 'string' ? bodyEmail : null);
  return verifyClaimedIdentity(request, claimed);
}

export async function POST(request: NextRequest) {
  let label: string | undefined;
  let bodyEmail: unknown;
  let purpose: unknown;
  try {
    const body = await request.json();
    bodyEmail = body?.email;
    purpose = body?.purpose;
    if (typeof body?.label === 'string' && body.label.trim()) label = body.label.trim().slice(0, 80);
  } catch {
    // no/invalid body → unlabeled key is fine
  }

  const identity = await keyOwner(request, bodyEmail);
  if (identity.status !== 'verified') return identityFailureResponse(identity);
  const auth = { email: identity.email };

  if (purpose !== undefined && purpose !== 'mcp' && purpose !== 'briefings') {
    return NextResponse.json({ error: "purpose must be 'mcp' or 'briefings'" }, { status: 400 });
  }
  const briefingsKey = purpose === 'briefings';

  try {
    if (briefingsKey) {
      const { key, row } = await issueApiKey(auth.email, { label: label || 'Briefings connection', scopes: [BRIEFINGS_READ_SCOPE] });
      return NextResponse.json({ success: true, key, keyInfo: row, signupCredits: 0 });
    }
    const { key, row } = await issueApiKey(auth.email, { label });
    // Grant one-time free credits on the user's FIRST key (no balance row yet).
    const signupCredits = await grantSignupCreditsIfFirst(auth.email).catch(() => 0);
    // Referral: if this verified user arrived via a ?ref link, credit the referrer (fire-and-forget).
    void qualifyReferralFromRequest(request, auth.email);
    // `key` is returned exactly once here and never again.
    return NextResponse.json({ success: true, key, keyInfo: row, signupCredits });
  } catch (err) {
    console.error('[mcp:keys] issue failed:', err);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const identity = await keyOwner(request);
  if (identity.status !== 'verified') return identityFailureResponse(identity);
  const auth = { email: identity.email };

  try {
    const keys = await listApiKeys(auth.email);
    return NextResponse.json({ success: true, keys });
  } catch (err) {
    console.error('[mcp:keys] list failed:', err);
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const identity = await keyOwner(request);
  if (identity.status !== 'verified') return identityFailureResponse(identity);
  const auth = { email: identity.email };

  const keyId = request.nextUrl.searchParams.get('id');
  if (!keyId) {
    return NextResponse.json({ error: 'Missing key id (?id=)' }, { status: 400 });
  }

  try {
    const revoked = await revokeApiKey(auth.email, keyId);
    if (!revoked) {
      // Not the caller's key, unknown id, or already revoked — don't leak which.
      return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 });
    }
    return NextResponse.json({ success: true, revoked: true });
  } catch (err) {
    console.error('[mcp:keys] revoke failed:', err);
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
  }
}
