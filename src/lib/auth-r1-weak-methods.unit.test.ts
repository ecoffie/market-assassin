/**
 * R1 (2026-10-04): weak authentication is removed.
 *   - verifyUserOwnsEmail no longer accepts the plaintext `ma_access_email` cookie (Method 3) or a
 *     claimed staff-domain email with no proof (Method 4).
 *   - Every Pro route that took a client-supplied email derives the tier from the VERIFIED identity.
 * Real verifyUserOwnsEmail, real signed Mindy session tokens, real route handlers.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const PRO = 'pro@example.com';
const OTHER = 'other@example.com';
const STAFF = 'someone@govcongiants.com';
const GOOGLE_JWT = 'google-session-jwt';
const TIER: Record<string, string> = { [PRO]: 'pro', [OTHER]: 'pro', [STAFF]: 'pro' };
const tierCalls: string[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async (j: string) => j === GOOGLE_JWT ? { data: { user: { email: PRO, app_metadata: { provider: 'google' } } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    from: () => { const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) }; return b; },
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('@/lib/api-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/api-auth')>();
  return {
    ...actual,
    verifyMIAccess: async (email: string) => { tierCalls.push(email); return { tier: TIER[email] || 'free', email, isStaff: false }; },
  };
});
vi.mock('@/lib/utils/calc-rates', () => ({
  fetchPricingIntel: async () => ({ laborCategories: [{ title: 'Engineer', median: 100 }] }),
  fetchPricingIntelByKeywords: async () => ({ laborCategories: [{ title: 'Engineer', median: 100 }] }),
}));

let tok: (e: string) => string;
let api: typeof import('@/lib/api-auth');
beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-unit-tests';
  process.env.EMAIL_ACTION_SECRET = 'test-email-action-secret-for-unit-tests';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
  tok = (await import('@/lib/two-factor-session')).createMIAuthSessionToken;
  api = await import('@/lib/api-auth');
});
beforeEach(() => { tierCalls.length = 0; });

const req = (url: string, h: Record<string, string> = {}) => new NextRequest(`https://getmindy.ai${url}`, { headers: h });

describe('verifyUserOwnsEmail: weak methods removed', () => {
  it.each([
    ['plaintext cookie equal to the claim', PRO, { cookie: `ma_access_email=${PRO}` }],
    ['claimed staff email, no proof', STAFF, {}],
    ['claimed staff email + matching cookie', STAFF, { cookie: `ma_access_email=${STAFF}` }],
    ['session for another account', OTHER, { 'x-mi-auth-token': 'PLACEHOLDER' }],
    ['tampered session', PRO, { 'x-mi-auth-token': 'PLACEHOLDER-TAMPER' }],
  ])('%s → refused', async (_n, claim, headers) => {
    const h = { ...headers } as Record<string, string>;
    if (h['x-mi-auth-token'] === 'PLACEHOLDER') h['x-mi-auth-token'] = tok(PRO);
    if (h['x-mi-auth-token'] === 'PLACEHOLDER-TAMPER') h['x-mi-auth-token'] = `${tok(PRO).slice(0, -3)}xyz`;
    const r = await api.verifyUserOwnsEmail(req('/api/x', h), claim);
    expect(r.authenticated).toBe(false);
  });

  it.each([
    ['signed Mindy session', { 'x-mi-auth-token': 'T' }],
    ['Supabase session', { authorization: `Bearer ${GOOGLE_JWT}` }],
  ])('%s → accepted', async (_n, headers) => {
    const h = { ...headers } as Record<string, string>;
    if (h['x-mi-auth-token'] === 'T') h['x-mi-auth-token'] = tok(PRO);
    expect((await api.verifyUserOwnsEmail(req('/api/x', h), PRO)).authenticated).toBe(true);
  });

  it('signed email-action link → accepted only for the email it signs', async () => {
    const { token, ts } = api.generateEmailToken(PRO);
    expect((await api.verifyUserOwnsEmail(req(`/api/x?token=${token}&ts=${ts}`), PRO)).authenticated).toBe(true);
    expect((await api.verifyUserOwnsEmail(req(`/api/x?token=${token}&ts=${ts}`), OTHER)).authenticated).toBe(false);
  });

  it('getEmailFromRequest no longer reads the cookie', () => {
    expect(api.getEmailFromRequest(req('/api/x', { cookie: `ma_access_email=${PRO}` }))).toBeNull();
  });
});

describe('verifiedClaimedEmail: the claim only when proven', () => {
  it('cookie / staff claim / mismatch → null; session → the email', async () => {
    expect(await api.verifiedClaimedEmail(req('/api/x', { cookie: `ma_access_email=${PRO}` }), PRO)).toBeNull();
    expect(await api.verifiedClaimedEmail(req('/api/x'), STAFF)).toBeNull();
    expect(await api.verifiedClaimedEmail(req('/api/x', { 'x-mi-auth-token': tok(PRO) }), OTHER)).toBeNull();
    expect(await api.verifiedClaimedEmail(req('/api/x', { 'x-mi-auth-token': tok(PRO) }), PRO.toUpperCase())).toBe(PRO);
  });
});

describe('Pro routes take the tier from the verified identity (real handlers)', () => {
  const pricing = async (email: string, h: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/app/pricing-intel/route');
    return GET(req(`/api/app/pricing-intel?naics=541512&email=${encodeURIComponent(email)}`, h));
  };
  it('pricing-intel: ?email= of a paying customer alone → 401, tier never read', async () => {
    expect((await pricing(PRO)).status).toBe(401);
    expect((await pricing(PRO, { cookie: `ma_access_email=${PRO}` })).status).toBe(401);
    expect((await pricing('nonexistent-probe@getmindy.ai')).status).toBe(401);
    expect(tierCalls).toEqual([]);
  });
  it('pricing-intel: verified Pro session → 200, tier read for the VERIFIED email', async () => {
    expect((await pricing(PRO, { 'x-mi-auth-token': tok(PRO) })).status).toBe(200);
    expect(tierCalls).toEqual([PRO]);
  });
  it('teaming/suggest (Contractor-DB contacts): anonymous → 401; verified → 200 with limit capped at 50', async () => {
    const { GET } = await import('@/app/api/teaming/suggest/route');
    expect((await GET(req('/api/teaming/suggest?naics=541512&limit=5000'))).status).toBe(401);
    expect((await GET(req(`/api/teaming/suggest?naics=541512&limit=5000&email=${PRO}`, { cookie: `ma_access_email=${PRO}` }))).status).toBe(401);
    const ok = await GET(req(`/api/teaming/suggest?naics=541512&limit=5000&email=${PRO}`, { 'x-mi-auth-token': tok(PRO) }));
    expect(ok.status).toBe(200);
    const j = await ok.json() as { suggestions?: unknown[]; partners?: unknown[]; results?: unknown[] };
    const rows = j.suggestions || j.partners || j.results || [];
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});

describe('route contract: no Pro route hands the raw claim to the tier check', () => {
  const ROUTES = [
    'src/app/api/app/competitor-awards/route.ts',
    'src/app/api/app/market-dossier/route.ts',
    'src/app/api/app/market-narrative/route.ts',
    'src/app/api/app/pricing-intel/route.ts',
    'src/app/api/app/target-market-research/route.ts',
    'src/app/api/market-overview/route.ts',
    'src/app/api/reports/generate-all/route.ts',
    'src/app/api/teaming/suggest/route.ts',
  ];
  it.each(ROUTES)('%s verifies before any tier read', (f) => {
    const src = readFileSync(join(__dirname, '..', '..', f), 'utf8');
    const v = src.indexOf('verifiedClaimedEmail(request');
    expect(v).toBeGreaterThan(-1);
    const t = src.indexOf('verifyMIAccess(');
    if (t > -1) expect(t).toBeGreaterThan(v);
    expect(src).not.toMatch(/verifyMIAccess\((claimedEmail|body\.email|email\s*\|\|)/);
  });
});
