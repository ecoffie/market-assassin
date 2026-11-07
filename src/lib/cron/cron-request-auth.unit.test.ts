import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

/**
 * Briefing/alert cron routes: test mode used to be authorized by `?email=&test=true` alone
 * (two routes by `?test=true` alone), and a client-supplied `x-vercel-cron: 1` header was
 * accepted as proof of a Vercel invocation. Both triggered LLM generation and emails.
 */

// Admin-session path stubbed to "no session" so only the shared-password path can grant admin.
vi.mock('@/lib/api-auth', () => ({
  verifyUserSession: vi.fn(async () => ({ authenticated: false })),
  getStaffRole: vi.fn(() => 'none'),
}));
vi.mock('@/lib/two-factor-session', () => ({ verifyTwoFactorSessionToken: vi.fn(() => ({ valid: false })) }));

const req = (qs = '', headers: Record<string, string> = {}) =>
  new NextRequest(`https://getmindy.ai/api/cron/weekly-deep-dive${qs}`, { headers });

const ENV = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env.CRON_SECRET = 'cron-secret-value-1234';
  process.env.ADMIN_PASSWORD = 'admin-password-value-1234';
  (process.env as Record<string, string>).NODE_ENV = 'production';
});
afterEach(() => { process.env = { ...ENV }; });

describe('authorizeCronRequest', () => {
  it('rejects an anonymous request with a bare 401 (no usage text, no counts)', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    const r = await authorizeCronRequest(req(), { isTest: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect(await r.response.json()).toEqual({ error: 'Unauthorized' });
    }
  });

  it('THE BYPASS: ?email=&test=true is NOT authorization', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    const r = await authorizeCronRequest(req('?email=someone@example.com&test=true'), { isTest: true });
    expect(r.ok).toBe(false);
  });

  it('a client-supplied x-vercel-cron header is NOT authorization', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    expect((await authorizeCronRequest(req('', { 'x-vercel-cron': '1' }), { isTest: false })).ok).toBe(false);
    expect((await authorizeCronRequest(req('?test=true', { 'x-vercel-cron': '1' }), { isTest: true })).ok).toBe(false);
  });

  it('rejects malformed / wrong bearers, and "Bearer undefined" when CRON_SECRET is unset', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    for (const h of ['Bearer wrong', 'cron-secret-value-1234', 'Bearer  cron-secret-value-1234', 'Basic abc', '']) {
      expect((await authorizeCronRequest(req('', { authorization: h }), { isTest: false })).ok).toBe(false);
    }
    delete process.env.CRON_SECRET;
    expect((await authorizeCronRequest(req('', { authorization: 'Bearer undefined' }), { isTest: false })).ok).toBe(false);
  });

  it('the admin password does NOT authorize a full (non-test) run', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    const r = await authorizeCronRequest(req('?password=admin-password-value-1234'), { isTest: false });
    expect(r.ok).toBe(false);
  });

  it('a wrong admin password does not authorize test mode', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    const r = await authorizeCronRequest(req('?test=true&password=nope', { 'x-admin-password': 'nope' }), { isTest: true });
    expect(r.ok).toBe(false);
  });

  it('authorizes the dispatcher bearer for a full run', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    const r = await authorizeCronRequest(req('', { authorization: 'Bearer cron-secret-value-1234' }), { isTest: false });
    expect(r).toMatchObject({ ok: true, via: 'cron_secret' });
  });

  it('authorizes admin test mode via query password or x-admin-password header', async () => {
    const { authorizeCronRequest } = await import('./cron-request-auth');
    expect(await authorizeCronRequest(req('?test=true&password=admin-password-value-1234'), { isTest: true }))
      .toMatchObject({ ok: true, via: 'admin' });
    expect(await authorizeCronRequest(req('?test=true', { 'x-admin-password': 'admin-password-value-1234' }), { isTest: true }))
      .toMatchObject({ ok: true, via: 'admin' });
  });

  it('keeps local (non-production) behavior: passes', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    const { authorizeCronRequest } = await import('./cron-request-auth');
    expect((await authorizeCronRequest(req(), { isTest: false })).ok).toBe(true);
  });
});

describe('every briefing/alert cron route uses it, before any work', () => {
  const ROUTES = ['weekly-deep-dive', 'send-briefings', 'send-weekly-fast', 'send-briefings-fast', 'precompute-briefings', 'precompute-weekly-briefings'];
  for (const r of ROUTES) {
    it(`${r}: no header trust, no email/test bypass, auth before the first data/LLM/send call`, () => {
      const src = readFileSync(join(process.cwd(), `src/app/api/cron/${r}/route.ts`), 'utf8');
      const code = src.replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/x-vercel-cron/);
      expect(code).not.toMatch(/testEmail && isTest\)\)|!hasCronSecret && !isTest/);
      const get = code.indexOf('export async function GET');
      const authAt = code.indexOf('authorizeCronRequest(request', get);
      expect(authAt).toBeGreaterThan(get);
      for (const sideEffect of ['getSupabase()', 'sendEmail(', 'generateBriefingJson(', 'generateAIBriefing(', 'resolveBriefingAudience(']) {
        const at = code.indexOf(sideEffect, get);
        if (at !== -1) expect(authAt).toBeLessThan(at);
      }
    });
  }
});
