import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMIAuthSessionToken, getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { attachMIAuthCookie, clearMIAuthCookie, jsonWithMIAuth, MI_AUTH_COOKIE, MI_AUTH_COOKIE_MAX_AGE_S } from './mi-auth-cookie';
import { SESSION_TTL_MS } from './mi-auth-constants';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'universal-mi-cookie-unit-test-secret';
});

function cookieFromSetCookie(header: string | null): string {
  if (!header) return '';
  const first = header.split(';')[0] || '';
  return first.slice(first.indexOf('=') + 1);
}

describe('mi_auth cookie helper', () => {
  it('aligns cookie maxAge with the 30-day HMAC TTL', () => {
    expect(MI_AUTH_COOKIE).toBe('mi_auth');
    expect(MI_AUTH_COOKIE_MAX_AGE_S).toBe(Math.floor(SESSION_TTL_MS / 1000));
    expect(MI_AUTH_COOKIE_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
  });

  it('sets HttpOnly, Path=/, SameSite=Lax, host-only (no Domain)', () => {
    const res = NextResponse.json({ ok: true });
    attachMIAuthCookie(res, 'token-value');
    const raw = res.headers.get('set-cookie') || '';
    expect(raw).toContain(`${MI_AUTH_COOKIE}=token-value`);
    expect(raw.toLowerCase()).toContain('httponly');
    expect(raw.toLowerCase()).toContain('path=/');
    expect(raw.toLowerCase()).toMatch(/samesite=lax/);
    expect(raw.toLowerCase()).not.toContain('domain=');
  });

  it('clears the cookie with maxAge 0', () => {
    const res = NextResponse.json({ ok: true });
    clearMIAuthCookie(res);
    const raw = res.headers.get('set-cookie') || '';
    expect(raw).toContain(`${MI_AUTH_COOKIE}=`);
    expect(raw).toMatch(/max-age=0/i);
  });

  it('jsonWithMIAuth writes Set-Cookie when a sessionToken is minted', () => {
    const token = createMIAuthSessionToken('maps@example.com');
    const res = jsonWithMIAuth({ success: true, sessionToken: token });
    const raw = res.headers.get('set-cookie') || '';
    expect(raw).toContain(MI_AUTH_COOKIE);
    expect(verifyTwoFactorSessionToken(cookieFromSetCookie(raw)).valid).toBe(true);
  });
});

describe('getTwoFactorTokenFromRequest — header first, then cookie', () => {
  it('header wins when both header and cookie are present', () => {
    const headerToken = createMIAuthSessionToken('header@example.com');
    const cookieToken = createMIAuthSessionToken('cookie@example.com');
    const req = new NextRequest('https://getmindy.ai/api/mcp/session', {
      headers: {
        'x-mi-auth-token': headerToken,
        cookie: `${MI_AUTH_COOKIE}=${cookieToken}`,
      },
    });
    const token = getTwoFactorTokenFromRequest(req);
    const verified = verifyTwoFactorSessionToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.email).toBe('header@example.com');
  });

  it('uses the cookie when no header is present', () => {
    const cookieToken = createMIAuthSessionToken('cookie@example.com');
    const req = new NextRequest('https://getmindy.ai/mcp', {
      headers: { cookie: `${MI_AUTH_COOKIE}=${cookieToken}` },
    });
    const token = getTwoFactorTokenFromRequest(req);
    const verified = verifyTwoFactorSessionToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.email).toBe('cookie@example.com');
  });

  it('returns null when neither header nor cookie is present', () => {
    const req = new NextRequest('https://getmindy.ai/mcp');
    expect(getTwoFactorTokenFromRequest(req)).toBeNull();
    expect(verifyTwoFactorSessionToken(null).valid).toBe(false);
  });

  it('still accepts x-mi-2fa-token and Bearer (compat)', () => {
    const t2 = createMIAuthSessionToken('twofa@example.com');
    const req2 = new NextRequest('https://getmindy.ai/api/mcp/session', {
      headers: { 'x-mi-2fa-token': t2 },
    });
    expect(verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(req2)).email).toBe('twofa@example.com');

    const bearer = createMIAuthSessionToken('bearer@example.com');
    const reqB = new NextRequest('https://getmindy.ai/api/mcp/session', {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(reqB)).email).toBe('bearer@example.com');
  });
});
