/**
 * Connected apps: authorization-code flow with PKCE, a server-signed state, server-side token exchange.
 *
 * The callback carries no Mindy session header (it is a provider redirect), so WHO is connecting and FOR WHICH
 * workspace is bound at /start, after verifyUserOwnsEmail + the acting-scope resolver, into an HMAC-signed,
 * short-lived state. The PKCE verifier travels inside that state encrypted (secretbox), never in clear.
 *
 * Browser binding: a signed state alone is a bearer credential. Anyone who starts a flow could forward the
 * consent link to someone else, and that person's account would land in the starter's workspace. So /start also
 * sets a random HttpOnly cookie on the starting browser and puts its SHA-256 in the state; the callback refuses
 * unless the same browser presents the matching cookie.
 */
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretbox';
import { clientCreds, connectedAppsSecrets, endpoints, redirectUri, scopesFor, type Capability, type Provider } from './config';

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

/** HttpOnly cookie that ties a flow to the browser that started it. Scoped to the callback path only. */
export const BINDING_COOKIE = 'mindy_ca_bind';
export const BINDING_COOKIE_PATH = '/api/app/connected-apps/callback';

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function secrets() {
  const s = connectedAppsSecrets();
  if (!s) throw new Error('connected-apps: dedicated secrets not configured');
  return s;
}

const sha256 = (v: string) => b64u(crypto.createHash('sha256').update(v).digest());

/** A fresh browser binding: the cookie value for the browser and the hash that goes in the signed state. */
export function newBrowserBinding(): { cookie: string; hash: string } {
  const cookie = b64u(crypto.randomBytes(32));
  return { cookie, hash: sha256(cookie) };
}

/**
 * Only a same-origin absolute path may be a return target (no open redirect). Control characters and whitespace are
 * refused outright: URL parsing strips tab/newline, so "/\t/evil.com" would otherwise become "//evil.com". The result
 * must also resolve to the same origin.
 */
const RETURN_ORIGIN = 'https://return.invalid';
export function safeReturnTo(raw: unknown): string {
  const s = String(raw || '').slice(0, 500);
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(s)) return '/app';
  try {
    const u = new URL(s, RETURN_ORIGIN);
    if (u.origin !== RETURN_ORIGIN) return '/app';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/app';
  }
}

/** Every provider call is bounded: a hung provider never holds a request or a chat turn. */
export const PROVIDER_TIMEOUT_MS = 12_000;
export const providerSignal = () => AbortSignal.timeout(PROVIDER_TIMEOUT_MS);

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function signState(p: Omit<StatePayload, 'exp' | 'nonce'>, verifier: string, bindingHash: string, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!bindingHash) throw new Error('connected-apps: a browser binding is required');
  const { stateSecret, tokenKey } = secrets();
  const payload: StatePayload & { v: string; b: string } = { ...p, exp: nowSec + STATE_TTL_SEC, nonce: b64u(crypto.randomBytes(12)), v: encryptSecret(verifier, tokenKey), b: bindingHash };
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64u(crypto.createHmac('sha256', stateSecret).update(body).digest());
  return `${body}.${sig}`;
}

const eq = (x: string, y: string) => {
  const a = Buffer.from(x);
  const b = Buffer.from(y);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export type VerifiedState =
  | { ok: true; payload: StatePayload; verifier: string }
  | { ok: false; reason: 'invalid_state' | 'browser_mismatch' };

/**
 * Verify signature, expiry AND the browser binding. `bindingCookie` is the BINDING_COOKIE value the callback
 * request carried; missing or different = browser_mismatch (the link was opened somewhere other than where the
 * flow started). The payload is only returned when every check passes.
 */
export function verifyState(state: string, bindingCookie: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): VerifiedState {
  const bad = { ok: false as const, reason: 'invalid_state' as const };
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return bad;
  const { stateSecret, tokenKey } = secrets();
  if (!eq(sig, b64u(crypto.createHmac('sha256', stateSecret).update(body).digest()))) return bad;
  let p: StatePayload & { v: string; b: string };
  try {
    p = JSON.parse(unb64u(body).toString('utf8'));
  } catch {
    return bad;
  }
  if (!p.exp || p.exp < nowSec) return bad;
  if (p.provider !== 'google' && p.provider !== 'microsoft') return bad;
  if (!p.b || !bindingCookie || !eq(p.b, sha256(bindingCookie))) return { ok: false, reason: 'browser_mismatch' };
  try {
    return { ok: true, payload: { provider: p.provider, ownerEmail: p.ownerEmail, scopeKey: p.scopeKey, caps: p.caps, returnTo: safeReturnTo(p.returnTo), exp: p.exp, nonce: p.nonce }, verifier: decryptSecret(p.v, tokenKey) };
  } catch {
    return bad;
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
    signal: providerSignal(),
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

/**
 * `scopes` (optional): ask for an access token limited to these scopes (a subset of the grant). Used for the Google
 * Picker token, which reaches the browser and must never carry mail scopes. The caller checks what came back.
 */
export function refreshTokens(provider: Provider, refreshToken: string, f: Fetch = fetch, scopes?: string[]): Promise<TokenSet> {
  return tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken, ...(scopes?.length ? { scope: scopes.join(' ') } : {}) }, f);
}

/** The provider's immutable account id and email for the grant (what we show and key on). */
export async function fetchIdentity(provider: Provider, accessToken: string, f: Fetch = fetch): Promise<{ accountId: string; email: string; name: string | null }> {
  const res = await f(endpoints(provider).identity, { headers: { authorization: `Bearer ${accessToken}` }, signal: providerSignal() });
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
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), signal: providerSignal() }).catch(() => null);
  return res && res.ok ? 'revoked' : 'failed';
}
