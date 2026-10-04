/**
 * Authorize approval — POST /api/oauth/authorize/approve.
 *
 * The consent page (/oauth/authorize) calls this AFTER the user clicks Allow.
 * Identity comes ONLY from the user's verified session (the signed Mindy session or a
 * Supabase session). The body's `email` is a claim that must match it; it never decides
 * who is granting access. This is how we stay keyless without a second identity system.
 * We re-validate the client + redirect_uri server-side (never trust the page),
 * mint a single-use PKCE-bound authorization code, and hand back the redirect
 * the browser should follow to the client with ?code=…&state=….
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyClaimedIdentity } from '@/lib/api-auth';
import { getClient, saveAuthCode } from '@/lib/mcp/oauth/store';
import { MCP_SCOPE } from '@/lib/mcp/oauth/tokens';
import { oauthGate } from '@/lib/mcp/oauth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const gated = oauthGate();
  if (gated) return gated;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const identity = await verifyClaimedIdentity(
    request,
    typeof body.email === 'string' ? body.email : request.nextUrl.searchParams.get('email'),
  );
  if (identity.status !== 'verified') {
    return NextResponse.json(
      { error: 'unauthorized', error_description: identity.status === 'mismatch' ? 'Email mismatch with session' : 'Sign in required' },
      { status: 401 },
    );
  }
  const auth = { email: identity.email };

  const clientId = String(body.client_id || '');
  const redirectUri = String(body.redirect_uri || '');
  const codeChallenge = String(body.code_challenge || '');
  const codeChallengeMethod = String(body.code_challenge_method || 'S256');
  const responseType = String(body.response_type || 'code');
  const scope = typeof body.scope === 'string' && body.scope ? body.scope : MCP_SCOPE;
  const state = typeof body.state === 'string' ? body.state : '';
  const resource = typeof body.resource === 'string' ? body.resource : undefined;

  // Validate the client + the redirect_uri against what was REGISTERED. This is
  // the guard against code exfiltration to an attacker-controlled redirect.
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  if (!client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'redirect_uri not registered for this client' }, { status: 400 });
  }
  if (responseType !== 'code') {
    return NextResponse.json({ error: 'unsupported_response_type' }, { status: 400 });
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return NextResponse.json({ error: 'invalid_request', error_description: 'PKCE code_challenge (S256) is required' }, { status: 400 });
  }

  const code = await saveAuthCode({
    clientId,
    userEmail: auth.email,
    redirectUri,
    codeChallenge,
    scope,
    resource,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return NextResponse.json({ redirect: url.toString() });
}
