import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authorizeUrl, exchangeCode, fetchIdentity, OAuthError, pkcePair, safeReturnTo, signState, verifyState, STATE_TTL_SEC } from './oauth';
import { connectedAppsEnabledFor, scopesFor } from './config';
import crypto from 'node:crypto';

const ENV = ['CONNECTED_APPS_STATE_SECRET', 'CRM_TOKEN_ENC_KEY', 'CONNECTED_APPS_GOOGLE_CLIENT_ID', 'CONNECTED_APPS_GOOGLE_CLIENT_SECRET', 'CONNECTED_APPS_MICROSOFT_CLIENT_ID', 'CONNECTED_APPS_MICROSOFT_CLIENT_SECRET', 'CONNECTED_APPS_REDIRECT_BASE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test';
  process.env.CRM_TOKEN_ENC_KEY = 'enc-key-test';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_ID = 'g-id';
  process.env.CONNECTED_APPS_GOOGLE_CLIENT_SECRET = 'g-secret';
  process.env.CONNECTED_APPS_MICROSOFT_CLIENT_ID = 'm-id';
  process.env.CONNECTED_APPS_MICROSOFT_CLIENT_SECRET = 'm-secret';
  process.env.CONNECTED_APPS_REDIRECT_BASE = 'https://getmindy.ai';
});
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const base = { provider: 'google' as const, ownerEmail: 'a@b.com', scopeKey: 'own:a@b.com', caps: ['file' as const], returnTo: '/app?panel=map' };

describe('signed state', () => {
  it('round-trips the verified user, scope and PKCE verifier', () => {
    const { verifier } = pkcePair();
    const v = verifyState(signState(base, verifier));
    expect(v?.payload).toMatchObject({ ownerEmail: 'a@b.com', scopeKey: 'own:a@b.com', caps: ['file'], returnTo: '/app?panel=map' });
    expect(v?.verifier).toBe(verifier);
  });
  it('does not carry the verifier in clear', () => {
    const { verifier } = pkcePair();
    const s = signState(base, verifier);
    expect(Buffer.from(s.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).not.toContain(verifier);
  });
  it('rejects a tampered state (another user or scope)', () => {
    const s = signState(base, 'v');
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), scopeKey: 'ws:victim' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
  });
  it('expires', () => {
    const now = Math.floor(Date.now() / 1000);
    const s = signState(base, 'v', now);
    expect(verifyState(s, now + STATE_TTL_SEC - 1)).not.toBeNull();
    expect(verifyState(s, now + STATE_TTL_SEC + 1)).toBeNull();
  });
  it('garbage is rejected', () => {
    expect(verifyState('')).toBeNull();
    expect(verifyState('a.b')).toBeNull();
  });
});

describe('safeReturnTo (no open redirect)', () => {
  it.each([['/app', '/app'], ['/app?panel=map', '/app?panel=map'], ['https://evil.com', '/app'], ['//evil.com', '/app'], ['/\\evil', '/app'], [null, '/app']])('%s -> %s', (raw, out) => {
    expect(safeReturnTo(raw)).toBe(out);
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
  it('never requests restricted or send scopes', () => {
    const all = [...scopesFor('google', ['file', 'draft', 'calendar']), ...scopesFor('microsoft', ['file', 'draft', 'calendar'])];
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
