/**
 * Connected apps: authorization-code flow with PKCE, a server-signed state, server-side token exchange.
 *
 * The callback carries no Mindy session header (it is a provider redirect), so WHO is connecting and FOR WHICH
 * workspace is bound at /start, after verifyUserOwnsEmail + the acting-scope resolver, into an HMAC-signed,
 * short-lived state. The PKCE verifier travels inside that state encrypted (secretbox), never in clear.
 */
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretbox';
import { clientCreds, endpoints, redirectUri, scopesFor, type Capability, type Provider } from './config';

export const STATE_TTL_SEC = 600;

export interface StatePayload {
  provider: Provider;
  /** The Mindy user who started the flow (verified at /start). */
  ownerEmail: string;
  /** Acting scope key: `own:<email>` or `ws:<workspaceId>` (see scopeKeyFor). */
  scopeKey: string;
  caps: Capability[];
  /** Same-origin path to return to (the Ask Mindy conversation). */
  returnTo: string;
  exp: number;
  nonce: string;
}

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function stateKey(env: Record<string, string | undefined> = process.env): string {
  const k = env.CONNECTED_APPS_STATE_SECRET || env.MCP_OAUTH_SIGNING_SECRET || env.ADMIN_PASSWORD;
  if (!k) throw new Error('connected-apps: no state signing secret');
  return k;
}

/** Only a same-origin absolute path may be a return target (no open redirect). */
export function safeReturnTo(raw: unknown): string {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s.slice(0, 500) : '/app';
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function signState(p: Omit<StatePayload, 'exp' | 'nonce'>, verifier: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const payload: StatePayload & { v: string } = { ...p, exp: nowSec + STATE_TTL_SEC, nonce: b64u(crypto.randomBytes(12)), v: encryptSecret(verifier) };
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64u(crypto.createHmac('sha256', stateKey()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(state: string, nowSec = Math.floor(Date.now() / 1000)): { payload: StatePayload; verifier: string } | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expected = b64u(crypto.createHmac('sha256', stateKey()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(unb64u(body).toString('utf8')) as StatePayload & { v: string };
    if (!p.exp || p.exp < nowSec) return null;
    if (p.provider !== 'google' && p.provider !== 'microsoft') return null;
    return { payload: { provider: p.provider, ownerEmail: p.ownerEmail, scopeKey: p.scopeKey, caps: p.caps, returnTo: safeReturnTo(p.returnTo), exp: p.exp, nonce: p.nonce }, verifier: decryptSecret(p.v) };
  } catch {
    return null;
  }
}

export function authorizeUrl(provider: Provider, state: string, challenge: string, caps: Capability[], opts: { loginHint?: string } = {}): string {
  const creds = clientCreds(provider);
  if (!creds) throw new Error(`connected-apps: ${provider} is not configured`);
  const u = new URL(endpoints(provider).authorize);
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', scopesFor(provider, caps).join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'google') {
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('include_granted_scopes', 'true');
    // Always show the account chooser: the account in the browser must not be linked by mistake.
    u.searchParams.set('prompt', 'consent select_account');
  } else {
    u.searchParams.set('prompt', 'select_account');
  }
  if (opts.loginHint) u.searchParams.set('login_hint', opts.loginHint);
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  grantedScopes: string[];
}

type Fetch = typeof fetch;

async function tokenRequest(provider: Provider, params: Record<string, string>, f: Fetch): Promise<TokenSet> {
  const creds = clientCreds(provider);
  if (!creds) throw new Error(`connected-apps: ${provider} is not configured`);
  const res = await f(endpoints(provider).token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...params }).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== 'string') {
    // Sanitized: provider error code only, never tokens or bodies.
    const code = typeof j.error === 'string' ? j.error : `http_${res.status}`;
    throw new OAuthError(code);
  }
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
    expiresAt: Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000,
    grantedScopes: typeof j.scope === 'string' ? j.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export class OAuthError extends Error {
  constructor(public code: string) { super(`oauth_error:${code}`); }
  /** The grant is dead (revoked/expired): the user must reconnect. */
  get needsReauth(): boolean { return this.code === 'invalid_grant' || this.code === 'interaction_required' || this.code === 'consent_required'; }
}

export function exchangeCode(provider: Provider, code: string, verifier: string, f: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier }, f);
}

export function refreshTokens(provider: Provider, refreshToken: string, f: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken }, f);
}

/** The provider's immutable account id and email for the grant (what we show and key on). */
export async function fetchIdentity(provider: Provider, accessToken: string, f: Fetch = fetch): Promise<{ accountId: string; email: string; name: string | null }> {
  const res = await f(endpoints(provider).identity, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new OAuthError(`identity_http_${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  if (provider === 'google') {
    if (!j.sub || !j.email) throw new OAuthError('identity_incomplete');
    return { accountId: String(j.sub), email: String(j.email).toLowerCase(), name: (j.name as string) ?? null };
  }
  const email = String(j.mail || j.userPrincipalName || '').toLowerCase();
  if (!j.id || !email) throw new OAuthError('identity_incomplete');
  return { accountId: String(j.id), email, name: (j.displayName as string) ?? null };
}

export async function revokeAtProvider(provider: Provider, token: string, f: Fetch = fetch): Promise<'revoked' | 'not_supported' | 'failed'> {
  const url = endpoints(provider).revoke;
  if (!url) return 'not_supported';
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }).catch(() => null);
  return res && res.ok ? 'revoked' : 'failed';
}
