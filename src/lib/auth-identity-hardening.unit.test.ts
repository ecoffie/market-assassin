import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

/**
 * R1 — forged-identity regressions (tasks/mindy-entitlement-audit-2026-09-26.md §12 E1).
 *
 * Every case here was a working exploit before R1:
 *   - a forged `ma_access_email` cookie authenticated as anyone (Method 3)
 *   - any claimed staff-domain email authenticated with no proof (Method 4)
 *   - `?email=<a paying customer>` on a Pro route returned that customer's paid output
 *   - `teaming/suggest` returned Contractor-DB SBLO contacts to anyone
 */

const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser },
    from: () => { throw new Error('DB must not be touched by a refused request'); },
    rpc: async () => ({ error: null }),
  }),
}));

const verifyMIAccess = vi.fn();
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api-auth')>();
  return { ...actual, verifyMIAccess: (...a: unknown[]) => verifyMIAccess(...a) };
});

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.EMAIL_ACTION_SECRET = 'email-action-test-secret';
process.env.TWO_FACTOR_SECRET = 'two-factor-test-secret';
process.env.AUTH_OBSERVE = 'off';

const auth = await import('./api-auth');
const { createMIAuthSessionToken } = await import('./two-factor-session');

const PAYER = 'payer@customer.com';
const ATTACKER = 'attacker@evil.com';
const STAFF = 'nobody@govcongiants.com';

function req(path: string, init: { headers?: Record<string, string>; cookie?: string; method?: string; body?: unknown } = {}) {
  const headers = new Headers(init.headers || {});
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`https://getmindy.ai${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const mi = (email: string) => ({ 'x-mi-auth-token': createMIAuthSessionToken(email) });

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  verifyMIAccess.mockReset();
  verifyMIAccess.mockImplementation(async (email: string) =>
    email === PAYER ? { tier: 'pro', email, isStaff: false } : { tier: 'free', email, isStaff: false });
});

describe('verifyUserOwnsEmail refuses forged identities', () => {
  it('a forged ma_access_email cookie → 401', async () => {
    const r = await auth.verifyUserOwnsEmail(req('/api/opportunities/save', { cookie: `ma_access_email=${PAYER}` }), PAYER);
    expect(r.authenticated).toBe(false);
  });

  it('a claimed staff email with no proof → 401', async () => {
    const r = await auth.verifyUserOwnsEmail(req('/api/team/upgrade'), STAFF);
    expect(r.authenticated).toBe(false);
  });

  it('legitimate strong methods still authenticate exactly as before', async () => {
    expect(await auth.verifyUserOwnsEmail(req('/api/x', { headers: mi(PAYER) }), PAYER))
      .toEqual({ authenticated: true, email: PAYER, method: 'session' });
    const ts = Math.floor(Date.now() / 1000);
    const token = createHmac('sha256', 'email-action-test-secret').update(`${PAYER}:${ts}`).digest('hex').substring(0, 32);
    expect(await auth.verifyUserOwnsEmail(req(`/api/x?token=${token}&ts=${ts}`), PAYER))
      .toEqual({ authenticated: true, email: PAYER, method: 'token' });
    getUser.mockResolvedValue({ data: { user: { email: PAYER, app_metadata: { provider: 'google' } } }, error: null });
    const s = await auth.verifyUserOwnsEmail(req('/api/x', { headers: { authorization: 'Bearer jwt' } }), PAYER);
    expect(s).toMatchObject({ authenticated: true, email: PAYER, method: 'session' });
  });
});

describe('verifyClaimedIdentity', () => {
  it('anonymous: no proof, whatever is claimed', async () => {
    expect(await auth.verifyClaimedIdentity(req('/x', { cookie: `ma_access_email=${PAYER}` }), PAYER)).toEqual({ status: 'anonymous' });
    expect(await auth.verifyClaimedIdentity(req('/x'), STAFF)).toEqual({ status: 'anonymous' });
  });
  it('mismatch: a real session claiming someone else', async () => {
    expect(await auth.verifyClaimedIdentity(req('/x', { headers: mi(ATTACKER) }), PAYER))
      .toEqual({ status: 'mismatch', verifiedEmail: ATTACKER });
  });
  it('verified: MI session, MI Bearer, Supabase session', async () => {
    expect(await auth.verifyClaimedIdentity(req('/x', { headers: mi(PAYER) }), PAYER.toUpperCase()))
      .toEqual({ status: 'verified', email: PAYER, method: 'session' });
    expect(await auth.verifyClaimedIdentity(req('/x', { headers: { authorization: `Bearer ${createMIAuthSessionToken(PAYER)}` } }), PAYER))
      .toMatchObject({ status: 'verified', email: PAYER });
    getUser.mockResolvedValue({ data: { user: { email: PAYER } }, error: null });
    expect(await auth.verifyClaimedIdentity(req('/x', { headers: { authorization: 'Bearer supabase-jwt' } }), PAYER))
      .toMatchObject({ status: 'verified', email: PAYER });
  });
  it('a forged MI token (wrong signature) is anonymous', async () => {
    const t = createMIAuthSessionToken(PAYER);
    const forged = t.split('.')[0] + '.' + 'A'.repeat(43);
    expect(await auth.verifyClaimedIdentity(req('/x', { headers: { 'x-mi-auth-token': forged } }), PAYER)).toEqual({ status: 'anonymous' });
  });
});

describe('spoofed ?email on Pro routes', () => {
  it('pricing-intel: spoofed payer email → 401, tier never read', async () => {
    const { GET } = await import('@/app/api/app/pricing-intel/route');
    const res = await GET(req(`/api/app/pricing-intel?email=${PAYER}&naics=541512`, { cookie: `ma_access_email=${PAYER}` }));
    expect(res.status).toBe(401);
    expect(verifyMIAccess).not.toHaveBeenCalled();
  });

  it('pricing-intel: attacker session claiming the payer → 401 mismatch', async () => {
    const { GET } = await import('@/app/api/app/pricing-intel/route');
    const res = await GET(req(`/api/app/pricing-intel?email=${PAYER}&naics=541512`, { headers: mi(ATTACKER) }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Email mismatch with session');
    expect(verifyMIAccess).not.toHaveBeenCalled();
  });

  it('pricing-intel: a claimed staff email → 401 (no staff bypass by address)', async () => {
    const { GET } = await import('@/app/api/app/pricing-intel/route');
    const res = await GET(req(`/api/app/pricing-intel?email=${STAFF}&naics=541512`));
    expect(res.status).toBe(401);
  });

  it('pricing-intel: a VERIFIED Free user still gets the same 402 teaser as before', async () => {
    const { GET } = await import('@/app/api/app/pricing-intel/route');
    const res = await GET(req(`/api/app/pricing-intel?email=${ATTACKER}&naics=541512`, { headers: mi(ATTACKER) }));
    expect(res.status).toBe(402);
    expect(verifyMIAccess).toHaveBeenCalledWith(ATTACKER);
  });

  it('competitor-awards: spoofed ?email → 401', async () => {
    const { GET } = await import('@/app/api/app/competitor-awards/route');
    const res = await GET(req(`/api/app/competitor-awards?email=${PAYER}&name=Booz`));
    expect(res.status).toBe(401);
    expect(verifyMIAccess).not.toHaveBeenCalled();
  });

  it('market-narrative: spoofed body email → 401 before any cache write', async () => {
    const { POST } = await import('@/app/api/app/market-narrative/route');
    const res = await POST(req('/api/app/market-narrative', { method: 'POST', body: { email: PAYER, naics: '541512' } }));
    expect(res.status).toBe(401);
    expect(verifyMIAccess).not.toHaveBeenCalled();
  });

  it('market-dossier: spoofed ?email → 401 before the private profile is read', async () => {
    const { GET } = await import('@/app/api/app/market-dossier/route');
    const res = await GET(req(`/api/app/market-dossier?email=${PAYER}`));
    expect(res.status).toBe(401);
  });

  it('teaming/suggest: unauthenticated → 401 (Contractor-DB contacts)', async () => {
    const { GET } = await import('@/app/api/teaming/suggest/route');
    const res = await GET(req('/api/teaming/suggest?naics=541512&limit=100000'));
    expect(res.status).toBe(401);
  });

  it('teaming/suggest: verified → 200 and the page size is capped at 50', async () => {
    const { GET } = await import('@/app/api/teaming/suggest/route');
    const res = await GET(req(`/api/teaming/suggest?naics=54&limit=100000&email=${PAYER}`, { headers: mi(PAYER) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const list = j.suggestions || j.data?.suggestions || [];
    expect(list.length).toBeLessThanOrEqual(50);
  });
});

describe('source guards — no route reads tier off an unproven email', () => {
  const ROUTES = [
    'src/app/api/app/pricing-intel/route.ts',
    'src/app/api/app/competitor-awards/route.ts',
    'src/app/api/app/market-narrative/route.ts',
    'src/app/api/app/market-dossier/route.ts',
    'src/app/api/app/target-market-research/route.ts',
    'src/app/api/reports/generate-all/route.ts',
    'src/app/api/market-overview/route.ts',
    'src/app/api/teaming/suggest/route.ts',
  ];
  const root = join(__dirname, '..', '..');
  for (const r of ROUTES) {
    it(`${r} resolves a verified identity before any tier read`, () => {
      const src = readFileSync(join(root, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const idx = src.search(/verifyClaimedIdentity\(\s*request/);
      expect(idx).toBeGreaterThan(-1);
      const tierRead = src.indexOf('verifyMIAccess(');
      if (tierRead > -1) expect(tierRead).toBeGreaterThan(idx);
      expect(src).not.toMatch(/verifyMIAccess\(email\)/);
    });
  }

  it('generate-all no longer calls /api/alerts/save-profile', () => {
    const src = readFileSync(join(root, 'src/app/api/reports/generate-all/route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/alerts\/save-profile/);
  });
});
