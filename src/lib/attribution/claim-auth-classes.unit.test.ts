/**
 * GUARD — every auth class associates the anonymous share history with the account, through the
 * REAL route handlers: Google + Microsoft (mi-session), email signup (mindy-complete-signup, the
 * setup-password path that mints no token), and password sign-in (mi-login).
 *
 * Only the identity providers are stubbed (Supabase getUser / signInWithPassword — OAuth cannot
 * run headless); the cookie read, the claim, the share validation and the signup_attribution
 * write are the shipped code against an in-memory table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeFakeDb } from './fake-db.test-helper';

const B = 'anon:11111111-2222-4333-8444-555555555555';
const S = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const X = '0fdb5f972b2a46648adf2e2b8a6558ce';
const SHARER = 'user-a@example.com';

let tables: Record<string, Record<string, unknown>[]>;
function seed() {
  tables = {
    user_engagement: [
      { user_email: SHARER, event_source: 'opportunity_map', created_at: '2026-09-20T10:00:00Z',
        metadata: { action: 'listing_share', share_id: S, notice_id: X, kind: 'opp', method: 'clipboard' } },
      { user_email: B, event_source: 'opportunity_map', created_at: '2026-09-20T11:00:00Z',
        metadata: { action: 'map_view', entry: 'share', share_id: S, notice_id: X } },
    ],
    signup_attribution: [],
  };
}
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => makeFakeDb(tables) }));
vi.mock('@/lib/mcp/referrals', () => ({ qualifyReferralFromRequest: vi.fn(async () => {}) }));
vi.mock('@/lib/mindy/free-profile', () => ({ ensureMindyFreeProfile: vi.fn(async () => {}) }));

const session = vi.hoisted(() => ({ email: '', provider: 'google', createdAt: '2026-09-20T12:00:00Z' }));
vi.mock('@/lib/api-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth')>()),
  verifyUserSession: vi.fn(async () => ({ authenticated: true, email: session.email, method: 'session', provider: session.provider, createdAt: session.createdAt })),
}));
vi.mock('@supabase/supabase-js', async (orig) => ({
  ...(await orig<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { signInWithPassword: async ({ email }: { email: string }) => ({ data: { user: { email, created_at: session.createdAt } }, error: null }) } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'anon';
process.env.ADMIN_PASSWORD ||= 'test-secret';

const cookieHeader = () => {
  const attr = { first_touch: { entry: 'share', share_id: S, notice_id: X, utm_source: 'share', captured_at: '2026-09-20T11:00:00Z' } };
  return `mindy_anon=${encodeURIComponent(B)}; gca_attr=${encodeURIComponent(JSON.stringify(attr))}`;
};
const req = (path: string, body?: unknown) => new NextRequest(`https://getmindy.ai${path}`, {
  method: 'POST', headers: { cookie: cookieHeader(), authorization: 'Bearer supabase-token', 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

async function claimedRow(email: string) {
  await vi.waitFor(() => expect(tables.signup_attribution.find((r) => r.email === email)).toBeTruthy());
  return tables.signup_attribution.find((r) => r.email === email)!;
}

beforeEach(() => { seed(); session.createdAt = '2026-09-20T12:00:00Z'; });

describe('every auth class claims the anonymous share history', () => {
  it.each([['google'], ['azure']])('OAuth (%s) via mi-session → row with anon_id + share_id', async (provider) => {
    session.email = `oauth-${provider}@example.com`; session.provider = provider;
    const { POST } = await import('@/app/api/auth/mi-session/route');
    expect((await POST(req('/api/auth/mi-session'))).status).toBe(200);
    expect(await claimedRow(session.email)).toMatchObject({ anon_id: B, share_id: S, entry: 'share', source: 'share' });
  });

  it('email signup via mindy-complete-signup (setup-password path) → row with anon_id + share_id', async () => {
    session.email = 'emailsignup@example.com';
    const { POST } = await import('@/app/api/auth/mindy-complete-signup/route');
    expect((await POST(req('/api/auth/mindy-complete-signup'))).status).toBe(200);
    expect(await claimedRow(session.email)).toMatchObject({ anon_id: B, share_id: S });
  });

  it('email signup whose mi-signup row already exists is ENRICHED, not duplicated', async () => {
    session.email = 'formsignup@example.com';
    tables.signup_attribution.push({ id: 7, email: session.email, utm_source: 'share', anon_id: null, created_at: '2026-09-20T11:05:00Z' });
    const { POST } = await import('@/app/api/auth/mindy-complete-signup/route');
    await POST(req('/api/auth/mindy-complete-signup'));
    await vi.waitFor(() => expect(tables.signup_attribution[0].anon_id).toBe(B));
    expect(tables.signup_attribution).toHaveLength(1);
    expect(tables.signup_attribution[0].share_id).toBe(S);
  });

  it('password sign-in (mi-login) of a NEW account claims', async () => {
    const { POST } = await import('@/app/api/auth/mi-login/route');
    const res = await POST(req('/api/auth/mi-login', { email: 'pw@example.com', password: 'x' }));
    expect(res.status).toBe(200);
    expect(await claimedRow('pw@example.com')).toMatchObject({ anon_id: B, share_id: S });
  });

  it('an EXISTING account signing in writes nothing', async () => {
    session.email = 'old@example.com'; session.createdAt = '2024-01-01T00:00:00Z';
    const { POST } = await import('@/app/api/auth/mi-session/route');
    await POST(req('/api/auth/mi-session'));
    await new Promise((r) => setTimeout(r, 30));
    expect(tables.signup_attribution).toHaveLength(0);
  });

  it('no mindy_anon cookie (a browser that never visited anonymously) writes nothing', async () => {
    session.email = 'nocookie@example.com';
    const { POST } = await import('@/app/api/auth/mi-session/route');
    await POST(new NextRequest('https://getmindy.ai/api/auth/mi-session', { method: 'POST', headers: { authorization: 'Bearer t' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(tables.signup_attribution).toHaveLength(0);
  });
});
