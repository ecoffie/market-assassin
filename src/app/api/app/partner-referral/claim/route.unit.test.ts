/**
 * SEC-5d — POST /api/app/partner-referral/claim takes the identity from a VERIFIED session only
 * (signed Mindy session token, or a verified Supabase session such as Google OAuth). Real token
 * verification; Supabase is in-memory.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const settings = new Map<string, Row>();
const claims = new Map<string, Row>();
const GOOGLE_JWT = 'google-oauth-session-jwt';

function from(table: string) {
  const st: { op: string; payload?: Row; eq: Record<string, unknown> } = { op: 'select', eq: {} };
  const store = table === 'user_notification_settings' ? settings : claims;
  const run = async () => {
    const key = String(st.eq.user_email ?? st.payload?.user_email ?? '');
    if (st.op === 'select') return { data: store.get(key) ?? null, error: null };
    if (st.op === 'insert') { if (store.has(key)) return { data: null, error: { code: '23505', message: 'dup' } }; store.set(key, { ...st.payload }); return { data: null, error: null }; }
    if (st.op === 'update') { if (!store.has(key)) return { data: null, count: 0, error: null }; store.set(key, { ...store.get(key), ...st.payload }); return { data: null, count: 1, error: null }; }
    if (st.op === 'delete') { store.delete(key); return { data: null, error: null }; }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, eq: (c: string, v: unknown) => { st.eq[c] = v; return b; },
    insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
    update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
    delete: () => { st.op = 'delete'; return b; },
    maybeSingle: () => run(),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from,
    auth: {
      getUser: async (jwt: string) => jwt === GOOGLE_JWT
        ? { data: { user: { email: 'oauth@example.com', app_metadata: { provider: 'google' } } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
  }),
}));
vi.mock('@/lib/access/resolve-access', () => ({
  resolveAccess: async (email: string) => ({ level: email === 'paid@example.com' ? 'pro' : 'free' }),
}));

let tokenFor: (email: string) => string;
beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-unit-tests';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
  tokenFor = (await import('@/lib/two-factor-session')).createMIAuthSessionToken;
});
const free = (email: string): Row => ({ user_email: email, alerts_enabled: true, alert_frequency: 'daily', trial_source: null, invitation_source: null });
beforeEach(() => {
  settings.clear(); claims.clear();
  for (const e of ['a@example.com', 'b@example.com', 'oauth@example.com', 'paid@example.com']) settings.set(e, free(e));
});

async function claim(body: Row, headers: Record<string, string> = {}) {
  const { POST } = await import('./route');
  const res = await POST(new NextRequest('http://localhost/api/app/partner-referral/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Row };
}

describe('identity comes only from a verified session', () => {
  it('anonymous (no session) → 401, no trial', async () => {
    const r = await claim({ code: 'MDEAT', email: 'a@example.com' });
    expect(r.status).toBe(401);
    expect(claims.size).toBe(0);
  });

  it('invalid session token → 401', async () => {
    expect((await claim({ code: 'MDEAT' }, { 'x-mi-auth-token': 'forged.token' })).status).toBe(401);
    expect(claims.size).toBe(0);
  });

  it('plaintext ma_access_email cookie is not identity → 401', async () => {
    expect((await claim({ code: 'MDEAT' }, { cookie: 'ma_access_email=a@example.com' })).status).toBe(401);
  });

  it('arbitrary / spoofed body email is irrelevant: the trial lands on the SESSION account only', async () => {
    const r = await claim({ code: 'MDEAT', email: 'b@example.com', user_email: 'b@example.com' }, { 'x-mi-auth-token': tokenFor('a@example.com') });
    expect(r.status).toBe(200);
    expect(claims.has('a@example.com')).toBe(true);
    expect(claims.has('b@example.com')).toBe(false);
    expect(settings.get('b@example.com')?.trial_source).toBeNull();
  });

  it('Google OAuth verified user (Supabase session) → claim works', async () => {
    const r = await claim({ code: 'NCMBC' }, { authorization: `Bearer ${GOOGLE_JWT}` });
    expect(r.status).toBe(200);
    expect(r.json.partner).toBe('NCMBC');
    expect(claims.get('oauth@example.com')?.identity_method).toBe('supabase_session');
  });
});

describe('outcomes tell the browser whether to keep the pending code', () => {
  it('claimed → clearPending true', async () => {
    const r = await claim({ code: 'MDEAT' }, { 'x-mi-auth-token': tokenFor('a@example.com') });
    expect(r.json).toMatchObject({ success: true, status: 'claimed', clearPending: true });
  });
  it('replay → 409 already_claimed, clearPending true, no second trial', async () => {
    await claim({ code: 'MDEAT' }, { 'x-mi-auth-token': tokenFor('a@example.com') });
    const first = settings.get('a@example.com')?.trial_ends_at;
    const r = await claim({ code: 'NCMBC' }, { 'x-mi-auth-token': tokenFor('a@example.com') });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ status: 'already_claimed', clearPending: true });
    expect(settings.get('a@example.com')?.trial_ends_at).toBe(first);
  });
  it('invalid code → 400, clearPending true', async () => {
    const r = await claim({ code: 'BOGUS' }, { 'x-mi-auth-token': tokenFor('a@example.com') });
    expect(r.status).toBe(400);
    expect(r.json.clearPending).toBe(true);
  });
  it('active Paid → 409 not eligible, nothing consumed', async () => {
    const r = await claim({ code: 'MDEAT' }, { 'x-mi-auth-token': tokenFor('paid@example.com') });
    expect(r.json).toMatchObject({ status: 'not_eligible_active_pro', clearPending: true });
    expect(claims.size).toBe(0);
  });
  it('no settings row yet → 409 profile_required, clearPending FALSE (retry after onboarding)', async () => {
    const r = await claim({ code: 'MDEAT' }, { 'x-mi-auth-token': tokenFor('brand-new@example.com') });
    expect(r.json).toMatchObject({ status: 'profile_required', clearPending: false });
    expect(settings.has('brand-new@example.com')).toBe(false);
  });
});
