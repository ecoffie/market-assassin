/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the ChatGPT profile endpoint.
 *
 * Served at /.well-known/oauth-protected-resource/chatgpt/mcp (the path-suffixed
 * well-known URI for https://mcp.getmindy.ai/chatgpt/mcp) via a next.config rewrite.
 * ChatGPT fetches this for the URL it was given and sends `resource=` with the value
 * below; the token endpoint then mints a ChatGPT-audience token that ONLY the
 * /chatgpt/mcp handler accepts.
 *
 * Same authorization server as the full endpoint. The full endpoint's metadata
 * (../route.ts) is untouched.
 */
import { NextResponse } from 'next/server';
import { OAUTH_ISSUER, MCP_SCOPE } from '@/lib/mcp/oauth/tokens';
import { OAUTH_RESOURCE_CHATGPT } from '@/lib/mcp/oauth/resources';
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
      resource: OAUTH_RESOURCE_CHATGPT,
      authorization_servers: [OAUTH_ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: [MCP_SCOPE],
      resource_name: 'Mindy — federal contracting research',
      resource_documentation: 'https://getmindy.ai',
    },
    { headers: CORS },
  );
}
