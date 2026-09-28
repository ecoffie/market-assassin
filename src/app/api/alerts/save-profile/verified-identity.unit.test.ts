/**
 * P0 SECURITY — POST /api/alerts/save-profile: only a VERIFIED identity may mutate a user's saved
 * targeting/profile state. Drives the REAL handler with the REAL verifyUserOwnsEmail and REAL
 * signed Mindy session tokens (no auth mock), against an in-memory settings table that enforces
 * the unique user_email constraint.
 *
 * Never authorized by: the body email, a query email, the plaintext `ma_access_email` cookie, or a
 * claimed staff address. `paid_existing` (which grants the KV `briefings:` Pro gate) needs a
 * database-backed invitation bound to the email — a session alone is not enough.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db: {
  settings: Map<string, Row>;
  bp: Map<string, Row>;
  invites: Map<string, Row>;
  writes: Array<{ table: string; op: string; payload: Row }>;
} = { settings: new Map(), bp: new Map(), invites: new Map(), writes: [] };
const grants: string[] = [];
const referrals: string[] = [];
let failWrites = false;

function builder(table: string) {
  const st: { op: string; payload?: Row; eq: Record<string, unknown>; isNull?: string[]; gt?: Record<string, string>; ignoreDup?: boolean } = { op: 'select', eq: {} };
  const run = () => {
    if (table === 'invitation_tokens') {
      const row = db.invites.get(String(st.eq.token));
      if (st.op === 'update') {
        // Atomic conditional claim: every guard must hold on the CURRENT row.
        const ok = !!row && (st.isNull ?? []).every((c) => row[c] == null)
          && Object.entries(st.gt ?? {}).every(([c, v]) => String(row[c]) > v);
        if (!ok) return { data: null, count: 0, error: null };
        Object.assign(row!, st.payload);
        db.writes.push({ table, op: 'update', payload: st.payload! });
        return { data: null, count: 1, error: null };
      }
      return { data: row ?? null, error: null };
    }
    const store = table === 'user_notification_settings' ? db.settings : table === 'user_business_profiles' ? db.bp : null;
    if (!store) return { data: null, error: null };
    const key = String(st.eq.user_email ?? st.payload?.user_email ?? '');
    if (st.op === 'select') return { data: store.get(key) ?? null, error: null };
    if (st.op !== 'select' && table === 'user_notification_settings' && failWrites) return { data: null, error: { code: 'XX000', message: 'injected write failure' } };
    if (st.op === 'insert' && store.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
    if (st.op === 'upsert' && st.ignoreDup && store.has(key)) return { data: store.get(key), error: null };
    db.writes.push({ table, op: st.op, payload: st.payload! });
    store.set(key, { ...(store.get(key) ?? {}), ...st.payload });
    return { data: store.get(key), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { st.eq[c] = v; return b; },
    is: (c: string, v: unknown) => { if (v === null) (st.isNull ??= []).push(c); return b; },
    gt: (c: string, v: string) => { (st.gt ??= {})[c] = v; return b; },
    update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
    upsert: (p: Row, o?: { ignoreDuplicates?: boolean }) => { st.op = 'upsert'; st.payload = p; st.ignoreDup = !!o?.ignoreDuplicates; return b; },
    insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
    maybeSingle: async () => run(),
    single: async () => run(),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: 'invalid JWT' } }) },
  }),
}));
vi.mock('@/lib/signup-events', () => ({
  logSignupEvent: async () => {}, logSignupCompleted: async () => {}, logSignupFailed: async () => {},
  SignupEventType: { SIGNUP_STARTED: 'signup_started' }, SignupStep: { EMAIL: 'email', DELIVERY: 'delivery' },
  extractIpAddress: () => null, extractUserAgent: () => null,
}));
vi.mock('@/lib/send-email', () => ({ sendEmail: async () => true }));
vi.mock('@/lib/briefings/pipelines/sam-gov', () => ({ fetchSamOpportunitiesFromCache: async () => ({ opportunities: [] }) }));
vi.mock('@/lib/briefings/access', () => ({ grantBriefingsAccess: async (e: string) => { grants.push(e); } }));
vi.mock('@/lib/mindy/apply-partner-referral', () => ({
  applyPartnerReferralIfEligible: async (_db: unknown, email: string) => { referrals.push(email); return { applied: false }; },
  partnerReferralSourceLabel: () => null,
}));

const A = 'alice@example.com';
const B = 'bob@example.com';
const STAFF = 'someone@govcongiants.com';
const STORED = (email: string): Row => ({
  user_email: email, business_type: 'SDVOSB', agencies: ['Department of Veterans Affairs'],
  naics_codes: ['238220'], location_zip: '22201', alerts_enabled: true, alert_frequency: 'daily',
  is_active: true, briefings_enabled: false,
});
const STRIPE_SECRET = 'sk_test_' + 'x'.repeat(40);
let tokenFor: (email: string) => string;

function inviteToken(customerId = 'cus_123', ts = Date.now()) {
  const secret = STRIPE_SECRET.slice(-32);
  const hmac = crypto.createHmac('sha256', secret).update(`${customerId}:${ts}`).digest('hex').slice(0, 16);
  return Buffer.from(`${customerId}:${ts}:${hmac}`).toString('base64url');
}

async function call(method: 'POST' | 'GET', body: Row, headers: Record<string, string> = {}, query = '') {
  const mod = await import('./route');
  const url = `http://localhost/api/alerts/save-profile${query}`;
  const req = method === 'POST'
    ? new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
    : new NextRequest(url, { method, headers });
  const res = method === 'POST' ? await mod.POST(req) : await mod.GET(req);
  return { status: res.status, json: await res.json() as Row };
}

beforeAll(async () => {
  process.env.TWO_FACTOR_SECRET = 'test-two-factor-secret-for-unit-tests';
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'x';
  const tfs = await import('@/lib/two-factor-session');
  tokenFor = (e) => tfs.createMIAuthSessionToken(e);
});

beforeEach(() => {
  db.settings = new Map([[A, STORED(A)], [B, STORED(B)], [STAFF, STORED(STAFF)]]);
  db.bp = new Map([[B, { user_email: B, business_description: 'Bob writes this himself' }]]);
  db.invites = new Map();
  db.writes = [];
  grants.length = 0;
  referrals.length = 0;
  failWrites = false;
});

const attack = { naicsCodes: ['541511'], businessType: 'Small Business', targetAgencies: [], businessDescription: 'overwritten' };
const noWrites = () => expect(db.writes.filter((w) => w.table !== 'invitation_tokens')).toEqual([]);

describe('rejected: no verified identity may touch an existing user', () => {
  it('no auth → rejected (existing user, free source)', async () => {
    const r = await call('POST', { email: B, ...attack, source: 'opportunity-hunter-free' });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('sign_in_required');
    noWrites();
    expect(db.settings.get(B)?.business_type).toBe('SDVOSB');
  });

  it('no auth → rejected for every free source', async () => {
    for (const source of ['free-signup', 'free_signup', 'opportunity-hunter-free']) {
      expect((await call('POST', { email: B, ...attack, source })).status).toBe(401);
    }
    noWrites();
  });

  it('invalid auth → rejected (garbage session token), never downgraded to anonymous', async () => {
    const r = await call('POST', { email: 'brand-new@example.com', ...attack, source: 'free-signup' }, { 'x-mi-auth-token': 'not.a-valid-token' });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('invalid_credentials');
    noWrites();
  });

  it('invalid auth → rejected (bad Supabase bearer)', async () => {
    const r = await call('POST', { email: B, ...attack, source: 'free-signup' }, { authorization: 'Bearer forged' });
    expect(r.status).toBe(401);
    noWrites();
  });

  it('user A claiming user B → rejected', async () => {
    const r = await call('POST', { email: B, ...attack, source: 'free-signup' }, { 'x-mi-auth-token': tokenFor(A) });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('invalid_credentials');
    noWrites();
    expect(db.settings.get(B)?.naics_codes).toEqual(['238220']);
  });

  it('plaintext ma_access_email cookie is not identity', async () => {
    const r = await call('POST', { email: B, ...attack, source: 'free-signup' }, { cookie: `ma_access_email=${B}` });
    expect(r.status).toBe(401);
    noWrites();
  });

  it('a claimed staff address is not identity', async () => {
    const r = await call('POST', { email: STAFF, ...attack, source: 'free-signup' });
    expect(r.status).toBe(401);
    noWrites();
  });

  it('a query-string email is not identity (the Pro source needs a verified session)', async () => {
    const r = await call('POST', { email: B, ...attack }, {}, `?email=${B}`);
    expect(r.status).toBe(401);
    noWrites();
  });
});

describe('verified A updating A → succeeds, with C-4 partial-update behavior preserved', () => {
  it('writes the submitted fields and keeps the omitted ones', async () => {
    const r = await call('POST', { email: A, naicsCodes: ['541512'], source: 'free-signup' }, { 'x-mi-auth-token': tokenFor(A) });
    expect(r.status).toBe(200);
    expect(db.settings.get(A)?.naics_codes).toEqual(['541512']);
    expect(db.settings.get(A)?.business_type).toBe('SDVOSB');           // C-4: omitted → untouched
    expect(db.settings.get(A)?.agencies).toEqual(['Department of Veterans Affairs']);
  });

  it('case/whitespace in the claimed email does not break a matching session', async () => {
    const r = await call('POST', { email: '  Alice@Example.com ', naicsCodes: ['541512'], source: 'free-signup' }, { 'x-mi-auth-token': tokenFor(A) });
    expect(r.status).toBe(200);
  });
});

describe('anonymous first signup still works — insert only', () => {
  it('a new email with no saved state is CREATED', async () => {
    const r = await call('POST', { email: 'new@example.com', naicsCodes: ['541512'], source: 'free-signup' });
    expect(r.status).toBe(200);
    const w = db.writes.find((x) => x.table === 'user_notification_settings')!;
    expect(w.op).toBe('insert');
  });

  it('a race (row appears after the read) is refused by the insert, not overwritten', async () => {
    const mod = await import('./route');
    // Simulate: the read sees no row, the insert hits the unique constraint.
    const origGet = db.settings.get.bind(db.settings);
    let reads = 0;
    db.settings.get = ((k: string) => (k === 'race@example.com' && reads++ === 0 ? undefined : origGet(k))) as typeof db.settings.get;
    db.settings.set('race@example.com', STORED('race@example.com'));
    const req = new NextRequest('http://localhost/api/alerts/save-profile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'race@example.com', ...attack, source: 'free-signup' }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
    expect(db.settings.get('race@example.com')?.business_type).toBe('SDVOSB');
  });

  it('an anonymous signup never overwrites an existing business profile', async () => {
    db.settings.delete(B); // no settings row, but a business profile exists
    const r = await call('POST', { email: B, naicsCodes: ['541512'], businessDescription: 'overwritten', source: 'free-signup' });
    expect(r.status).toBe(200);
    expect(db.bp.get(B)?.business_description).toBe('Bob writes this himself');
  });
});

describe('paid_existing grants Pro only with an invitation bound to the email', () => {
  const tok = inviteToken();
  const future = new Date(Date.now() + 864e5).toISOString();

  it('no invitation → rejected, no grant', async () => {
    const r = await call('POST', { email: 'new@example.com', source: 'paid_existing' });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('invite_required');
    expect(grants).toEqual([]);
    noWrites();
  });

  it('a verified session WITHOUT an invitation cannot self-grant Pro', async () => {
    const r = await call('POST', { email: A, source: 'paid_existing' }, { 'x-mi-auth-token': tokenFor(A) });
    expect(r.status).toBe(401);
    expect(grants).toEqual([]);
  });

  it('a signed token with no database row is not bound to anyone → rejected', async () => {
    const r = await call('POST', { email: 'new@example.com', source: 'paid_existing', inviteToken: tok });
    expect(r.status).toBe(401);
    expect(grants).toEqual([]);
  });

  it('an invitation addressed to a different email → rejected', async () => {
    db.invites.set(tok, { email: 'someone-else@example.com', used_at: null, expires_at: future });
    const r = await call('POST', { email: 'new@example.com', source: 'paid_existing', inviteToken: tok });
    expect(r.status).toBe(401);
    expect(grants).toEqual([]);
  });

  it('used or expired invitations → rejected', async () => {
    db.invites.set(tok, { email: 'new@example.com', used_at: new Date().toISOString(), expires_at: future });
    expect((await call('POST', { email: 'new@example.com', source: 'paid_existing', inviteToken: tok })).status).toBe(401);
    db.invites.set(tok, { email: 'new@example.com', used_at: null, expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await call('POST', { email: 'new@example.com', source: 'paid_existing', inviteToken: tok })).status).toBe(401);
    expect(grants).toEqual([]);
  });

  it('a forged signature → rejected', async () => {
    const forged = Buffer.from(`cus_123:${Date.now()}:deadbeefdeadbeef`).toString('base64url');
    db.invites.set(forged, { email: 'new@example.com', used_at: null, expires_at: future });
    expect((await call('POST', { email: 'new@example.com', source: 'paid_existing', inviteToken: forged })).status).toBe(401);
    expect(grants).toEqual([]);
  });

  it('a valid invitation bound to this email → activates', async () => {
    db.invites.set(tok, { email: 'new@example.com', used_at: null, expires_at: future });
    const r = await call('POST', { email: 'New@Example.com', source: 'paid_existing', inviteToken: tok });
    expect(r.status).toBe(200);
    expect(grants).toEqual(['new@example.com']);
  });
});

describe('GET reads only with a strong identity', () => {
  it('plaintext cookie → rejected', async () => {
    expect((await call('GET', {}, { cookie: `ma_access_email=${B}` }, `?email=${B}`)).status).toBe(401);
  });
  it('claimed staff address → rejected', async () => {
    expect((await call('GET', {}, {}, `?email=${STAFF}`)).status).toBe(401);
  });
  it('A reading B → rejected', async () => {
    expect((await call('GET', {}, { 'x-mi-auth-token': tokenFor(A) }, `?email=${B}`)).status).toBe(401);
  });
  it('A reading A → allowed', async () => {
    expect((await call('GET', {}, { 'x-mi-auth-token': tokenFor(A) }, `?email=${A}`)).status).toBe(200);
  });
});

describe('invitation is single-use; Pro is granted only after the profile write lands', () => {
  const future = () => new Date(Date.now() + 864e5).toISOString();

  it('a valid invite cannot be replayed', async () => {
    const tok = inviteToken('cus_replay');
    db.invites.set(tok, { email: 'replay@example.com', used_at: null, expires_at: future(), stripe_customer_id: 'cus_replay' });
    expect((await call('POST', { email: 'replay@example.com', source: 'paid_existing', inviteToken: tok })).status).toBe(200);
    const second = await call('POST', { email: 'replay@example.com', source: 'paid_existing', inviteToken: tok });
    expect(second.status).toBe(401);
    expect(grants).toEqual(['replay@example.com']); // exactly one grant
    expect(db.invites.get(tok)?.used_at).toBeTruthy();
  });

  it('two concurrent activations → exactly one succeeds, one grant', async () => {
    const tok = inviteToken('cus_race');
    db.invites.set(tok, { email: 'race2@example.com', used_at: null, expires_at: future() });
    const [a, b] = await Promise.all([
      call('POST', { email: 'race2@example.com', source: 'paid_existing', inviteToken: tok }),
      call('POST', { email: 'race2@example.com', source: 'paid_existing', inviteToken: tok }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect(grants).toEqual(['race2@example.com']);
  });

  it('the Stripe customer comes from the invitation, never the body', async () => {
    const tok = inviteToken('cus_real');
    db.invites.set(tok, { email: 'cust@example.com', used_at: null, expires_at: future(), stripe_customer_id: 'cus_real' });
    await call('POST', { email: 'cust@example.com', source: 'paid_existing', inviteToken: tok, stripeCustomerId: 'cus_attacker' });
    expect(db.settings.get('cust@example.com')?.stripe_customer_id).toBe('cus_real');
  });

  it('a failed profile write grants nothing and releases the invitation', async () => {
    const tok = inviteToken('cus_fail');
    db.invites.set(tok, { email: 'fail@example.com', used_at: null, expires_at: future() });
    failWrites = true;
    const r = await call('POST', { email: 'fail@example.com', source: 'paid_existing', inviteToken: tok });
    expect(r.status).toBe(500);
    expect(grants).toEqual([]);
    expect(db.invites.get(tok)?.used_at).toBeNull();
  });
});

describe('an anonymous signup cannot grant a Pro trial via a partner referral', () => {
  it('anonymous + referralCode → referral NOT applied', async () => {
    const r = await call('POST', { email: 'partner-anon@example.com', naicsCodes: ['541512'], source: 'free-signup', referralCode: 'MDEAT' });
    expect(r.status).toBe(200);
    expect(referrals).toEqual([]);
    expect(db.settings.get('partner-anon@example.com')?.briefings_enabled).not.toBe(true);
    expect(db.settings.get('partner-anon@example.com')?.trial_ends_at).toBeUndefined();
  });
  it('verified owner + referralCode → referral evaluated', async () => {
    const r = await call('POST', { email: A, naicsCodes: ['541512'], source: 'free-signup', referralCode: 'MDEAT' }, { 'x-mi-auth-token': tokenFor(A) });
    expect(r.status).toBe(200);
    expect(referrals).toEqual([A]);
  });
});
