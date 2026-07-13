/**
 * Token endpoint (OAuth 2.1) — POST /oauth/token.
 *   grant_type=authorization_code → verify PKCE + single-use code → access+refresh
 *   grant_type=refresh_token      → rotate refresh → new access+refresh
 * Public clients (no secret); PKCE is the proof-of-possession. Accepts
 * form-encoded (standard) or JSON. The 25 welcome credits are granted on the
 * FIRST successful code exchange (idempotent — gated on no balance row yet).
 */
import { NextRequest, NextResponse } from 'next/server';
import { consumeAuthCode, consumeRefreshToken, saveRefreshToken, getClient } from '@/lib/mcp/oauth/store';
import { issueAccessToken, verifyPkceS256, MCP_SCOPE } from '@/lib/mcp/oauth/tokens';
import { grantSignupCreditsIfFirst } from '@/lib/mcp/credits';

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

function err(error: string, description?: string, status = 400) {
  return NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, { status, headers: CORS });
}

async function parseBody(request: NextRequest): Promise<Record<string, string>> {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return (await request.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text)) as Record<string, string>;
}

export async function POST(request: NextRequest) {
  const body = await parseBody(request);
  const grantType = body.grant_type;

  // ── authorization_code ─────────────────────────────────────────────────────
  if (grantType === 'authorization_code') {
    const { code, code_verifier, client_id, redirect_uri } = body;
    if (!code || !code_verifier || !client_id) {
      return err('invalid_request', 'code, code_verifier, and client_id are required');
    }
    const record = await consumeAuthCode(code); // single-use claim
    if (!record) return err('invalid_grant', 'Authorization code is invalid, expired, or already used');
    if (record.client_id !== client_id) return err('invalid_grant', 'client_id mismatch');
    if (redirect_uri && record.redirect_uri !== redirect_uri) return err('invalid_grant', 'redirect_uri mismatch');
    if (!verifyPkceS256(code_verifier, record.code_challenge)) return err('invalid_grant', 'PKCE verification failed');

    const scope = record.scope || MCP_SCOPE;
    const access = issueAccessToken(record.user_email, client_id, scope);
    const refresh = await saveRefreshToken({ clientId: client_id, userEmail: record.user_email, scope, resource: record.resource ?? undefined });

    // Welcome grant on first connect (idempotent; no-op if they already have a balance row).
    try {
      await grantSignupCreditsIfFirst(record.user_email);
    } catch {
      /* never block token issuance on the grant */
    }

    return NextResponse.json(
      { access_token: access.token, token_type: 'Bearer', expires_in: access.expiresIn, refresh_token: refresh, scope },
      { headers: CORS },
    );
  }

  // ── refresh_token (rotation) ────────────────────────────────────────────────
  if (grantType === 'refresh_token') {
    const { refresh_token, client_id } = body;
    if (!refresh_token || !client_id) return err('invalid_request', 'refresh_token and client_id are required');
    const client = await getClient(client_id);
    if (!client) return err('invalid_client', 'Unknown client', 401);

    const row = await consumeRefreshToken(refresh_token); // rotate: old is revoked
    if (!row) return err('invalid_grant', 'Refresh token is invalid, expired, or revoked');
    if (row.client_id !== client_id) return err('invalid_grant', 'client_id mismatch');

    const scope = row.scope || MCP_SCOPE;
    const access = issueAccessToken(row.user_email, client_id, scope);
    const newRefresh = await saveRefreshToken({
      clientId: client_id,
      userEmail: row.user_email,
      scope,
      resource: row.resource ?? undefined,
      rotatedFrom: row.token_hash,
    });

    return NextResponse.json(
      { access_token: access.token, token_type: 'Bearer', expires_in: access.expiresIn, refresh_token: newRefresh, scope },
      { headers: CORS },
    );
  }

  return err('unsupported_grant_type', `grant_type '${grantType}' is not supported`);
}
