/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 * Served at /.well-known/oauth-protected-resource via a next.config rewrite.
 * Tells MCP clients which authorization server protects the Mindy MCP endpoint.
 */
import { NextResponse } from 'next/server';
import { OAUTH_ISSUER, OAUTH_RESOURCE, MCP_SCOPE } from '@/lib/mcp/oauth/tokens';
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
      resource: OAUTH_RESOURCE,
      authorization_servers: [OAUTH_ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: [MCP_SCOPE],
      resource_name: 'Mindy MCP — federal contracting intelligence',
    },
    { headers: CORS },
  );
}
