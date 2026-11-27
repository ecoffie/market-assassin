import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authorizeUrl, exchangeCode, fetchIdentity, newBrowserBinding, OAuthError, pkcePair, revokeAtProvider, safeReturnTo, signState, verifyState, STATE_TTL_SEC } from './oauth';
import { ACCESS_DISCLOSURE, connectedAppsEnabledFor, connectedAppsSecrets, FORBIDDEN_SCOPES, hasCapability, SCOPES, scopesFor } from './config';
import crypto from 'node:crypto';

const ENV = ['CONNECTED_APPS_STATE_SECRET', 'CONNECTED_APPS_TOKEN_ENC_KEY', 'CRM_TOKEN_ENC_KEY', 'MCP_OAUTH_SIGNING_SECRET', 'ADMIN_PASSWORD', 'CONNECTED_APPS_GOOGLE_CLIENT_ID', 'CONNECTED_APPS_GOOGLE_CLIENT_SECRET', 'CONNECTED_APPS_MICROSOFT_CLIENT_ID', 'CONNECTED_APPS_MICROSOFT_CLIENT_SECRET', 'CONNECTED_APPS_REDIRECT_BASE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test-0123456789abcdef0123';
  process.env.CONNECTED_APPS_TOKEN_ENC_KEY = 'token-key-test-0123456789abcdef01234567';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_ID = 'g-id';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_SECRET = 'g-secret';
  process.env.CONNECTED_APPS_MICROSOFT_CLIENT_ID = 'm-id';
  process.env.CONNECTED_APPS_MICROSOFT_CLIENT_SECRET = 'm-secret';
  process.env.CONNECTED_APPS_REDIRECT_BASE = 'https://getmindy.ai';
});
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const base = { provider: 'google' as const, ownerEmail: 'a@b.com', scopeKey: 'own:a@b.com', caps: ['file' as const], returnTo: '/app?panel=map' };

const bind = newBrowserBinding();
const sign = (verifier = 'v', now?: number) => signState(base, verifier, bind.hash, now);
const ok = (r: ReturnType<typeof verifyState>) => (r.ok ? r : null);

describe('signed state', () => {
  it('round-trips the verified user, scope and PKCE verifier', () => {
    const { verifier } = pkcePair();
    const v = ok(verifyState(sign(verifier), bind.cookie));
    expect(v?.payload).toMatchObject({ ownerEmail: 'a@b.com', scopeKey: 'own:a@b.com', caps: ['file'], returnTo: '/app?panel=map' });
    expect(v?.verifier).toBe(verifier);
  });
  it('does not carry the verifier or the binding cookie in clear', () => {
    const { verifier } = pkcePair();
    const decoded = Buffer.from(sign(verifier).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    expect(decoded).not.toContain(verifier);
    expect(decoded).not.toContain(bind.cookie);
  });
  it('rejects a tampered state (another user or scope)', () => {
    const [body, sig] = sign().split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), scopeKey: 'ws:victim' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyState(`${forged}.${sig}`, bind.cookie)).toEqual({ ok: false, reason: 'invalid_state' });
  });
  it('expires', () => {
    const now = Math.floor(Date.now() / 1000);
    const s = sign('v', now);
    expect(verifyState(s, bind.cookie, now + STATE_TTL_SEC - 1).ok).toBe(true);
    expect(verifyState(s, bind.cookie, now + STATE_TTL_SEC + 1).ok).toBe(false);
  });
  it('garbage is rejected', () => {
    expect(verifyState('', bind.cookie).ok).toBe(false);
    expect(verifyState('a.b', bind.cookie).ok).toBe(false);
  });
});

describe('browser binding (a forwarded consent link changes nothing)', () => {
  it('no binding cookie on the callback → browser_mismatch', () => {
    expect(verifyState(sign(), undefined)).toEqual({ ok: false, reason: 'browser_mismatch' });
    expect(verifyState(sign(), '')).toEqual({ ok: false, reason: 'browser_mismatch' });
  });
  it("another browser's cookie → browser_mismatch", () => {
    expect(verifyState(sign(), newBrowserBinding().cookie)).toEqual({ ok: false, reason: 'browser_mismatch' });
  });
  it('the state carries only the hash, so the state alone cannot be replayed', () => {
    const decoded = JSON.parse(Buffer.from(sign().split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(decoded.b).toBe(bind.hash);
    expect(verifyState(sign(), bind.hash)).toEqual({ ok: false, reason: 'browser_mismatch' });
  });
  it('signing without a binding is refused', () => {
    expect(() => signState(base, 'v', '')).toThrow(/binding/);
  });
});

describe('dedicated secrets (no shared fallback)', () => {
  it('ADMIN_PASSWORD / MCP_OAUTH_SIGNING_SECRET / CRM_TOKEN_ENC_KEY never stand in', () => {
    const env = { ADMIN_PASSWORD: 'x'.repeat(40), MCP_OAUTH_SIGNING_SECRET: 'y'.repeat(40), CRM_TOKEN_ENC_KEY: 'z'.repeat(40) };
    expect(connectedAppsSecrets(env)).toBeNull();
    delete process.env.CONNECTED_APPS_STATE_SECRET;
    Object.assign(process.env, env);
    expect(() => sign()).toThrow(/dedicated secrets/);
  });
  it('requires both, at least 32 characters, and different from each other', () => {
    expect(connectedAppsSecrets({ CONNECTED_APPS_STATE_SECRET: 'a'.repeat(40) })).toBeNull();
    expect(connectedAppsSecrets({ CONNECTED_APPS_STATE_SECRET: 'short', CONNECTED_APPS_TOKEN_ENC_KEY: 'b'.repeat(40) })).toBeNull();
    expect(connectedAppsSecrets({ CONNECTED_APPS_STATE_SECRET: 'a'.repeat(40), CONNECTED_APPS_TOKEN_ENC_KEY: 'a'.repeat(40) })).toBeNull();
    expect(connectedAppsSecrets({ CONNECTED_APPS_STATE_SECRET: 'a'.repeat(40), CONNECTED_APPS_TOKEN_ENC_KEY: 'b'.repeat(40) })).not.toBeNull();
  });
});

describe('safeReturnTo (no open redirect)', () => {
  it.each([['/app', '/app'], ['/app?panel=map', '/app?panel=map'], ['https://evil.com', '/app'], ['//evil.com', '/app'], ['/\\evil', '/app'], [null, '/app']])('%s -> %s', (raw, out) => {
    expect(safeReturnTo(raw)).toBe(out);
  });
  // URL parsing strips tab / CR / LF, so "/\t/evil.com" used to become "//evil.com" (Agent 4 review, verified).
  it.each(['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/ /evil.com', '/\u0000/evil.com', '/\u00a0/evil.com', '/\u2028/evil.com'])('control character or whitespace %j is refused', (raw) => {
    expect(safeReturnTo(raw)).toBe('/app');
  });
  it('whatever it returns resolves to our own origin', () => {
    for (const raw of ['/app?panel=ask#x', '/%2F%2Fevil.com', '/app/../app']) {
      const out = safeReturnTo(raw);
      expect(new URL(out, 'https://getmindy.ai').origin).toBe('https://getmindy.ai');
    }
  });
});

describe('provider calls are bounded', () => {
  it('token, identity and revoke requests carry an abort signal', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const f = (async (_u: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return new Response(JSON.stringify({ access_token: 'a', sub: '1', email: 'x@y.com' }), { status: 200 });
    }) as unknown as typeof fetch;
    await exchangeCode('google', 'c', 'v', f);
    await fetchIdentity('google', 'at', f);
    await revokeAtProvider('google', 't', f);
    expect(seen).toHaveLength(3);
    for (const sig of seen) expect(sig).toBeInstanceOf(AbortSignal);
  });
});

describe('authorizeUrl: PKCE, account chooser, least privilege', () => {
  it('Google: drive.file only for the file step, offline, chooser, S256', () => {
    const { challenge } = pkcePair();
    const u = new URL(authorizeUrl('google', 'st', challenge, ['file']));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/drive.file', 'openid', 'profile']);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toContain('select_account');
    expect(u.searchParams.get('redirect_uri')).toBe('https://getmindy.ai/api/app/connected-apps/callback');
  });
  it('capabilities: file and email drafts only; no calendar yet; the file step asks for no mail scope', () => {
    expect(Object.keys(SCOPES.google).sort()).toEqual(['draft', 'file', 'identity']);
    expect(Object.keys(SCOPES.microsoft).sort()).toEqual(['draft', 'file', 'identity']);
    const fileOnly = [...scopesFor('google', ['file']), ...scopesFor('microsoft', ['file'])].join(' ');
    expect(fileOnly).not.toMatch(/gmail|calendar|Mail\.|Calendars\./i);
    const all = [...scopesFor('google', ['file', 'draft']), ...scopesFor('microsoft', ['file', 'draft'])].join(' ');
    expect(all).not.toMatch(/calendar|Calendars\./i);
  });
  it('email drafts: exactly gmail.compose (Google) and Mail.ReadWrite (Microsoft), requested only with the draft capability', () => {
    expect(SCOPES.google.draft).toEqual(['https://www.googleapis.com/auth/gmail.compose']);
    expect(SCOPES.microsoft.draft).toEqual(['Mail.ReadWrite']);
    const g = new URL(authorizeUrl('google', 'st', 'ch', ['file', 'draft'])).searchParams.get('scope')!.split(' ');
    expect(g).toContain('https://www.googleapis.com/auth/gmail.compose');
    const m = new URL(authorizeUrl('microsoft', 'st', 'ch', ['file', 'draft'])).searchParams.get('scope')!.split(' ');
    expect(m).toContain('Mail.ReadWrite');
  });
  it('never requests a send or full-mailbox scope, for any capability (gmail.send, Mail.Send, https://mail.google.com/)', () => {
    const caps = ['file', 'draft'] as const;
    const all = [...scopesFor('google', [...caps]), ...scopesFor('microsoft', [...caps])];
    for (const f of FORBIDDEN_SCOPES) expect(all).not.toContain(f);
    expect(FORBIDDEN_SCOPES).toEqual(expect.arrayContaining(['https://www.googleapis.com/auth/gmail.send', 'Mail.Send', 'https://mail.google.com/']));
    expect(all.some((s) => /send/i.test(s))).toBe(false);
  });
  it('the draft access note is honest about each grant', () => {
    expect(ACCESS_DISCLOSURE.google.draft).toMatch(/also covers sending/);
    expect(ACCESS_DISCLOSURE.google.draft).toMatch(/Mindy never sends/);
    expect(ACCESS_DISCLOSURE.microsoft.draft).toMatch(/also lets an app read your mail/);
    expect(ACCESS_DISCLOSURE.microsoft.draft).toMatch(/cannot send/);
  });
  it('hasCapability reads granted scopes, including Graph-prefixed ones', () => {
    expect(hasCapability('google', ['openid', 'https://www.googleapis.com/auth/gmail.compose'], 'draft')).toBe(true);
    expect(hasCapability('google', ['https://www.googleapis.com/auth/drive.file'], 'draft')).toBe(false);
    expect(hasCapability('microsoft', ['https://graph.microsoft.com/Mail.ReadWrite', 'User.Read'], 'draft')).toBe(true);
    expect(hasCapability('microsoft', ['Files.Read'], 'draft')).toBe(false);
  });
  it('the access note describes the grant honestly: Microsoft Files.Read covers all OneDrive files', () => {
    expect(ACCESS_DISCLOSURE.microsoft.file).toMatch(/all of the files in your OneDrive/);
    expect(ACCESS_DISCLOSURE.microsoft.file).toMatch(/not only the ones you pick/);
    expect(ACCESS_DISCLOSURE.google.file).toMatch(/only the files you pick/);
  });
  it('never requests restricted or send scopes', () => {
    const all = [...scopesFor('google', ['file']), ...scopesFor('microsoft', ['file'])];
    expect(all).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(all).not.toContain('https://www.googleapis.com/auth/drive');
    expect(all).not.toContain('https://www.googleapis.com/auth/gmail.send');
    expect(all).not.toContain('Mail.Send');
    expect(all.some((s) => /Sites\.|\.All$/.test(s))).toBe(false);
  });
  it('Microsoft: Files.Read for the file step, offline_access, common tenant', () => {
    const u = new URL(authorizeUrl('microsoft', 'st', 'ch', ['file']));
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['Files.Read', 'User.Read', 'email', 'offline_access', 'openid', 'profile']);
  });
  it('refuses an unconfigured provider', () => {
    delete process.env.CONNECTED_APPS_MICROSOFT_CLIENT_ID;
    expect(() => authorizeUrl('microsoft', 's', 'c', ['file'])).toThrow(/not configured/);
  });
});

describe('token exchange and identity (mocked provider)', () => {
  it('exchanges with the verifier and returns tokens + granted scopes', async () => {
    let sent = '';
    const f = (async (_u: string, init: RequestInit) => { sent = String(init.body); return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/drive.file' }), { status: 200 }); }) as typeof fetch;
    const t = await exchangeCode('google', 'code-1', 'verifier-1', f);
    expect(sent).toContain('code_verifier=verifier-1');
    expect(sent).toContain('grant_type=authorization_code');
    expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt', grantedScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] });
  });
  it('a provider error is a sanitized code; invalid_grant means reconnect', async () => {
    const f = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked. secret-ish detail' }), { status: 400 })) as typeof fetch;
    const err = await exchangeCode('google', 'c', 'v', f).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe('invalid_grant');
    expect(err.needsReauth).toBe(true);
    expect(String(err.message)).not.toContain('secret-ish');
  });
  it('identity uses the provider immutable id and the chosen account email', async () => {
    const g = (async () => new Response(JSON.stringify({ sub: '1234', email: 'Owner@Acme.com', name: 'Owner' }))) as typeof fetch;
    expect(await fetchIdentity('google', 'at', g)).toEqual({ accountId: '1234', email: 'owner@acme.com', name: 'Owner' });
    const m = (async () => new Response(JSON.stringify({ id: 'abc', mail: null, userPrincipalName: 'Owner@Acme.onmicrosoft.com', displayName: 'O' }))) as typeof fetch;
    expect(await fetchIdentity('microsoft', 'at', m)).toEqual({ accountId: 'abc', email: 'owner@acme.onmicrosoft.com', name: 'O' });
  });
});

describe('flag', () => {
  it('is off by default and needs the allowlist', () => {
    expect(connectedAppsEnabledFor('a@b.com', {})).toBe(false);
    expect(connectedAppsEnabledFor('a@b.com', { CONNECTED_APPS: 'true' })).toBe(false);
    expect(connectedAppsEnabledFor('A@b.com', { CONNECTED_APPS: 'true', CONNECTED_APPS_ALLOWLIST: 'a@b.com' })).toBe(true);
  });
});

void crypto;
