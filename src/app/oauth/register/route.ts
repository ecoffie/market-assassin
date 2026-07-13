/**
 * Dynamic Client Registration (RFC 7591) — POST /oauth/register.
 * An MCP client (Claude Desktop, Cursor, …) self-registers once, gets a
 * client_id it uses for the authorize/token calls. Public clients only (PKCE),
 * so no client_secret is issued.
 */
import { NextRequest, NextResponse } from 'next/server';
import { registerClient } from '@/lib/mcp/oauth/store';
import { oauthGate } from '@/lib/mcp/oauth/guard';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function isHttpsOrLocal(uri: string): boolean {
  try {
    const u = new URL(uri);
    // Native clients use loopback or custom schemes; browsers use https.
    return (
      u.protocol === 'https:' ||
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.protocol !== 'http:' // custom scheme e.g. cursor:// , claude://
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const gated = oauthGate();
  if (gated) return gated;

  // DCR is unauthenticated by spec — rate-limit by IP so it can't be spammed to
  // fill the clients table. 20 registrations / hour / IP is ample for real clients.
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`rl:oauth:register:${ip}`, 20, 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'temporarily_unavailable', error_description: 'Too many registrations; try again later.' },
      { status: 429, headers: { ...CORS, 'Retry-After': String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, { status: 400, headers: CORS });
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === 'string' && isHttpsOrLocal(u))) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array of https/loopback/custom-scheme URIs' },
      { status: 400, headers: CORS },
    );
  }

  const client = await registerClient({
    client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
    redirect_uris: redirectUris as string[],
    scope: typeof body.scope === 'string' ? body.scope : 'mcp',
  });

  // RFC 7591 registration response.
  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: client.scope,
    },
    { status: 201, headers: CORS },
  );
}
