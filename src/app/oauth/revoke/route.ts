/**
 * Token revocation (RFC 7009) — POST /oauth/revoke.
 * Revokes a refresh token (access tokens are short-lived JWTs and expire on
 * their own). Always returns 200 per spec, even for unknown tokens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revokeRefreshToken } from '@/lib/mcp/oauth/store';

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

export async function POST(request: NextRequest) {
  const ct = request.headers.get('content-type') || '';
  let token: string | undefined;
  if (ct.includes('application/json')) {
    try {
      token = ((await request.json()) as { token?: string }).token;
    } catch {
      /* ignore */
    }
  } else {
    token = Object.fromEntries(new URLSearchParams(await request.text())).token;
  }
  if (token) await revokeRefreshToken(token);
  // RFC 7009: unconditional 200.
  return new NextResponse(null, { status: 200, headers: CORS });
}
