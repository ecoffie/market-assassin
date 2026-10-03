/**
 * R1 migration (2026-10-03): /api/briefings/latest authorizes ONLY a verified identity.
 * R0 measured paying customers reading briefings on the plaintext `ma_access_email` cookie,
 * which anyone can set to any address. This drives the REAL handler with the REAL
 * verifyUserOwnsEmail and REAL signed Mindy session tokens, plus the legacy migration path:
 * a one-time secure link (mailbox proof) → consume mints a session → briefings load.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PRO = 'pro@example.com';
const TEAM = 'team@example.com';
const FREE = 'free@example.com';
const OTHER = 'other-pro@example.com';
const GOOGLE_JWT = 'google-oauth-session-jwt';
const LEVEL: Record<string, string> = { [PRO]: 'pro', [TEAM]: 'pro', [OTHER]: 'pro', [FREE]: 'free' };
const reads: string[] = [];
const kvStore = new Map<string, unknown>();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (jwt: string) => jwt === GOOGLE_JWT
        ? { data: { user: { email: TEAM, app_metadata: { provider: 'google' } } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
    from: () => {
      const st: { email?: string } = {};
      const b: Record<string, unknown> = {
        select: () => b, lte: () => b, order: () => b,
        eq: (c: string, v: string) => { if (c === 'user_email') st.email = v; return b; },
        limit: async () => {
          reads.push(st.email!);
          return { data: [{ id: 1, briefing_date: '2026-10-02', briefing_type: 'daily', briefing_content: { owner: st.email }, items_count: 3, created_at: '2026-10-02T07:00:00Z' }], error: null };
        },
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/access/resolve-access', () => ({
  hasProAccess: async (email: string) => LEVEL[email] === 'pro',
  resolveAccess: async (email: string) => ({ level: LEVEL[email] || 'free' }),
}));
vi.mock('@vercel/kv', () => ({
  kv: {
    set: async (k: string, v: unknown) => { kvStore.set(k, v); return 'OK'; },
    get: async (k: string) => kvStore.get(k) ?? null,
    getdel: async (k: string) => { const v = kvStore.get(k) ?? null; kvStore.delete(k); return v; },
    del: async (k: string) => { kvStore.delete(k); return 1; },
  },
}));
vi.mock('@/lib/briefings/access', () => ({ hasBriefingsAccess: async (e: string) => LEVEL[e] === 'pro' }));
vi.mock('@/lib/send-email', () => ({ sendEmail: async () => true }));

let tokenFor: (email: string) => string;
beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-unit-tests';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
  tokenFor = (await import('@/lib/two-factor-session')).createMIAuthSessionToken;
});
beforeEach(() => { reads.length = 0; kvStore.clear(); });
afterEach(() => { vi.useRealTimers(); });

async function latest(email: string, headers: Record<string, string> = {}) {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/api/briefings/latest?email=${encodeURIComponent(email)}&days=30`, { headers }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

describe('a plain or forged cookie never authorizes briefings', () => {
  it('logged out → 401, nothing read', async () => {
    expect((await latest(PRO)).status).toBe(401);
    expect(reads).toEqual([]);
  });
  it('forged cookie naming a paying customer → 401', async () => {
    expect((await latest(PRO, { cookie: `ma_access_email=${PRO}` })).status).toBe(401);
    expect(reads).toEqual([]);
  });
  it('cookie for ANOTHER customer while signed in as someone else → 401 for the other account', async () => {
    const r = await latest(OTHER, { cookie: `ma_access_email=${OTHER}`, 'x-mi-auth-token': tokenFor(FREE) });
    expect(r.status).toBe(401);
    expect(reads).toEqual([]);
  });
  it('claimed staff address with no session → 401', async () => {
    expect((await latest('someone@govcongiants.com')).status).toBe(401);
  });
  it('tampered session token → 401', async () => {
    const t = tokenFor(PRO);
    expect((await latest(PRO, { 'x-mi-auth-token': `${t.slice(0, -2)}xx` })).status).toBe(401);
  });
  it('expired session token → 401', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    const old = tokenFor(PRO);
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    expect((await latest(PRO, { 'x-mi-auth-token': old })).status).toBe(401);
  });
});

describe('verified sessions keep exactly their entitlement', () => {
  it('normal Mindy signed-in Pro → 200, own briefings only', async () => {
    const r = await latest(PRO, { 'x-mi-auth-token': tokenFor(PRO) });
    expect(r.status).toBe(200);
    expect(reads).toEqual([PRO]);
  });
  it('Team (Supabase/Google session) → 200', async () => {
    const r = await latest(TEAM, { authorization: `Bearer ${GOOGLE_JWT}` });
    expect(r.status).toBe(200);
    expect(reads).toEqual([TEAM]);
  });
  it('Free with a valid session → 403 (no new entitlement)', async () => {
    expect((await latest(FREE, { 'x-mi-auth-token': tokenFor(FREE) })).status).toBe(403);
    expect(reads).toEqual([]);
  });
  it('a session for A naming B → 401', async () => {
    expect((await latest(OTHER, { 'x-mi-auth-token': tokenFor(PRO) })).status).toBe(401);
  });
});

describe('legacy legitimate Pro path: identification → verified session → /briefings', () => {
  it('cookie alone is refused, the one-time link mints a session for the LINK email, briefings load', async () => {
    // 1. Legacy browser: only the plaintext cookie → refused.
    expect((await latest(PRO, { cookie: `ma_access_email=${PRO}` })).status).toBe(401);

    // 2. The gate requests a secure link for the remembered address (emailed to that mailbox).
    const { POST: request } = await import('../../access-links/request/route');
    const req = await request(new NextRequest('https://getmindy.ai/api/access-links/request', {
      method: 'POST', body: JSON.stringify({ email: PRO, destination: 'briefings', returnTo: '/briefings' }),
    }));
    expect(req.status).toBe(200);
    const linkKey = [...kvStore.keys()][0];
    const linkToken = linkKey.replace(/^access-link:/, '');

    // 3. Consuming it (a body email is ignored) mints a session for the link's address.
    const { POST: consume } = await import('../../access-links/consume/route');
    const c = await consume(new NextRequest('https://getmindy.ai/api/access-links/consume', {
      method: 'POST', body: JSON.stringify({ token: linkToken, email: OTHER }),
    }));
    const cj = await c.json() as { sessionToken?: string; email?: string; redirectTo?: string };
    expect(cj.email).toBe(PRO);
    expect(cj.redirectTo).toBe('/briefings');
    expect(cj.sessionToken).toBeTruthy();

    // 4. The link is single-use.
    const again = await consume(new NextRequest('https://getmindy.ai/api/access-links/consume', {
      method: 'POST', body: JSON.stringify({ token: linkToken }),
    }));
    expect(again.status).toBe(404);

    // 5. /briefings now authenticates from the session — and only for that customer.
    expect((await latest(PRO, { 'x-mi-auth-token': cj.sessionToken! })).status).toBe(200);
    expect((await latest(OTHER, { 'x-mi-auth-token': cj.sessionToken! })).status).toBe(401);
  });

  it('a link request for a Free address is refused (no session minted, no entitlement)', async () => {
    const { POST: request } = await import('../../access-links/request/route');
    const r = await request(new NextRequest('https://getmindy.ai/api/access-links/request', {
      method: 'POST', body: JSON.stringify({ email: FREE, destination: 'briefings' }),
    }));
    expect(r.status).toBe(403);
    expect(kvStore.size).toBe(0);
  });

  it('a preferences link never mints a session; an unknown returnTo is ignored', async () => {
    const { createAccessLink } = await import('@/lib/access-links');
    const t = await createAccessLink(PRO, 'preferences');
    const { POST: consume } = await import('../../access-links/consume/route');
    const j = await (await consume(new NextRequest('https://x/api/access-links/consume', { method: 'POST', body: JSON.stringify({ token: t }) }))).json() as Record<string, unknown>;
    expect(j.sessionToken).toBeUndefined();
    const { normalizeReturnTo } = await import('@/lib/access-links');
    expect(normalizeReturnTo('https://evil.example/')).toBeUndefined();
    expect(normalizeReturnTo('/briefings')).toBe('/briefings');
  });
});
