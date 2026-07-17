/**
 * MCP OAuth — crypto core: access-token JWTs, opaque token/code generation,
 * hashing, and PKCE verification. No external JWT dep — HS256 is a few lines and
 * we control it. Diagnostics never log token material.
 *
 * Access tokens are STATELESS signed JWTs (validated by signature + exp + aud on
 * the hot path — no DB read). Authorization codes and refresh tokens are opaque
 * random strings; only their sha256 is persisted.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Origin that issues + protects tokens. Same-origin AS+RS (scope decision #1). */
export const OAUTH_ISSUER = (process.env.MCP_OAUTH_ISSUER || 'https://getmindy.ai').replace(/\/$/, '');
/** The protected MCP resource these tokens are minted for (RFC 8707 audience). */
/**
 * The canonical MCP resource. Two jobs at once, which is why it must not drift:
 *   1. the `resource` in /.well-known/oauth-protected-resource, which Anthropic
 *      requires to match the URL "exactly as the user enters it in Claude", and
 *   2. the access-token audience (`aud`) — verifyAccessToken rejects a mismatch.
 *
 * Default is the CANONICAL value, not a legacy one. It used to default to
 * https://getmindy.ai/mcp/mcp while production overrode it via MCP_OAUTH_RESOURCE
 * — so any environment without that env var (preview, local) silently advertised a
 * resource that didn't match what the connect page tells users to paste, and
 * deleting the env var would have reverted production to a broken URL.
 *
 * Keep byte-identical to MCP_URL in src/app/mcp/catalog-ui.tsx.
 */
export const OAUTH_RESOURCE = (process.env.MCP_OAUTH_RESOURCE || 'https://mcp.getmindy.ai/mcp').replace(/\/$/, '');
export const ACCESS_TTL_SEC = 3600; // 1 hour — refresh tokens renew
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 60; // 60 days
export const CODE_TTL_SEC = 300; // 5 minutes, single-use
export const MCP_SCOPE = 'mcp';

function signingSecret(): string {
  const s = process.env.MCP_OAUTH_SIGNING_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('MCP OAuth: no signing secret (set MCP_OAUTH_SIGNING_SECRET)');
  return s;
}

// ── base64url ───────────────────────────────────────────────────────────────
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

// ── opaque secrets (codes, refresh tokens, client ids) ───────────────────────
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}
export function sha256(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

// ── access-token JWT (HS256) ─────────────────────────────────────────────────
export interface AccessTokenClaims {
  sub: string; // user email
  aud: string; // resource
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
}

export function issueAccessToken(userEmail: string, clientId: string, scope = MCP_SCOPE): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    sub: userEmail.toLowerCase(),
    aud: OAUTH_RESOURCE,
    client_id: clientId,
    scope,
    iat: now,
    exp: now + ACCESS_TTL_SEC,
    jti: randomToken(12),
  };
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson(claims);
  const sig = b64url(createHmac('sha256', signingSecret()).update(`${header}.${payload}`).digest());
  return { token: `${header}.${payload}.${sig}`, expiresIn: ACCESS_TTL_SEC };
}

/** Verify signature + exp + audience. Returns claims or null (never throws). */
export function verifyAccessToken(token: string | null | undefined): AccessTokenClaims | null {
  if (!token || token.split('.').length !== 3) return null;
  const [header, payload, sig] = token.split('.');
  const expected = b64url(createHmac('sha256', signingSecret()).update(`${header}.${payload}`).digest());
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as AccessTokenClaims;
    if (!claims.sub || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    if (claims.aud !== OAUTH_RESOURCE) return null; // reject tokens minted for another resource
    return claims;
  } catch {
    return null;
  }
}

// ── PKCE (S256 required) ──────────────────────────────────────────────────────
/** True when code_verifier matches the stored S256 code_challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = b64url(createHash('sha256').update(codeVerifier, 'utf8').digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
