/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 * Served at /.well-known/oauth-authorization-server via a next.config rewrite.
 * Advertises our authorize/token/register/revoke endpoints so MCP clients can
 * discover how to authenticate. PKCE S256 required; public clients only (v1).
 */
import { NextResponse } from 'next/server';
import { OAUTH_ISSUER, MCP_SCOPE } from '@/lib/mcp/oauth/tokens';
import { oauthGate } from '@/lib/mcp/oauth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function GET() {
  const gated = oauthGate();
  if (gated) return gated;
  return NextResponse.json(
    {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
      token_endpoint: `${OAUTH_ISSUER}/oauth/token`,
      registration_endpoint: `${OAUTH_ISSUER}/oauth/register`,
      revocation_endpoint: `${OAUTH_ISSUER}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [MCP_SCOPE],
    },
    { headers: CORS },
  );
}
