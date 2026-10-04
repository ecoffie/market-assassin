import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

/**
 * R0 — auth-method observability must be BEHAVIOUR-NEUTRAL.
 * tasks/mindy-entitlement-audit-2026-09-26.md §14 R0.
 *
 * Four things are pinned here:
 *   1. verifyUserOwnsEmail no longer has the weak methods (R1 replaced R0's byte-for-byte pin).
 *   2. For every authentication method, the wrapper returns the SAME object the core returns.
 *   3. The logger never throws and never blocks, even when the database write fails.
 *   4. Aggregation keys and the email-recording rule are exactly what the R1 readout assumes.
 */

const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.EMAIL_ACTION_SECRET = 'email-action-test-secret';
process.env.TWO_FACTOR_SECRET = 'two-factor-test-secret';

const obs = await import('./auth-observability');
const { verifyUserOwnsEmail } = await import('./api-auth');
const { createMIAuthSessionToken } = await import('./two-factor-session');

type Written = { o: import('./auth-observability').AuthObservation; day: string };
let written: Written[] = [];

beforeEach(() => {
  written = [];
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  obs.__setObservationWriterForTests(async (o, day) => { written.push({ o, day }); });
});
afterEach(() => obs.__setObservationWriterForTests(null));

const flush = () => new Promise((r) => setTimeout(r, 0));

function req(path: string, init: { headers?: Record<string, string>; cookie?: string } = {}) {
  const headers = new Headers(init.headers || {});
  if (init.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(`https://getmindy.ai${path}`, { headers });
}

function signedLink(email: string) {
  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', process.env.EMAIL_ACTION_SECRET!).update(`${email}:${ts}`).digest('hex').substring(0, 32);
  return { token, ts };
}

// ─── 1. the decision logic did not change ──────────────────────────────────

describe('verifyUserOwnsEmail decision logic (R1: strong methods only)', () => {
  it('the core no longer reads the plaintext cookie or trusts a claimed staff address', () => {
    const src = readFileSync(join(__dirname, 'api-auth.ts'), 'utf8');
    const start = src.indexOf('async function verifyUserOwnsEmailCore(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start) + 3)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // code only, not the comments explaining it
    // R0 pinned this body byte-for-byte; R1 is the deliberate decision change it was waiting for.
    expect(body).not.toMatch(/ma_access_email/);
    expect(body).not.toMatch(/getStaffRole/);
    expect(body).not.toMatch(/method: 'cookie'/);
  });

  it('the exported wrapper returns the core result object itself and only observes', () => {
    const src = readFileSync(join(__dirname, 'api-auth.ts'), 'utf8');
    const wrapper = src.slice(src.indexOf('export async function verifyUserOwnsEmail('), src.indexOf('async function verifyUserOwnsEmailCore('));
    expect(wrapper).toMatch(/const result = await verifyUserOwnsEmailCore\(request, claimedEmail, options\);/);
    expect(wrapper).toMatch(/observeVerifyResult\(request, claimedEmail, result[^)]*\);\s*return result;/);
    expect(wrapper.match(/return /g)?.length).toBe(1);
  });
});

// ─── 2. same auth result for every method ──────────────────────────────────

describe('verifyUserOwnsEmail: identical results for every method, correctly classified', () => {
  const U = 'user@example.com';
  const STAFF = 'someone@govcongiants.com';

  type Case = {
    name: string;
    claim: string;
    build: () => NextRequest;
    supabaseEmail?: string;
    options?: { requireStrongAuth?: boolean };
    expectAuth: boolean;
    expectMethod: string | undefined;
    expectError?: string;
    observed: { method: string; verified: string; matches: string; email: string | null };
  };

  const cases: Case[] = [
    {
      name: 'supabase session',
      claim: U, supabaseEmail: U,
      build: () => req('/api/opportunities/save', { headers: { authorization: 'Bearer jwt' } }),
      expectAuth: true, expectMethod: 'session',
      observed: { method: 'supabase', verified: 'yes', matches: 'yes', email: null },
    },
    {
      name: 'supabase session for a DIFFERENT email',
      claim: U, supabaseEmail: 'other@example.com',
      build: () => req('/api/opportunities/save', { headers: { authorization: 'Bearer jwt' } }),
      expectAuth: false, expectMethod: undefined, expectError: 'Email mismatch with session',
      observed: { method: 'none', verified: 'yes', matches: 'no', email: null },
    },
    {
      name: 'signed email link',
      claim: U,
      build: () => { const { token, ts } = signedLink(U); return req(`/api/linked-emails?token=${token}&ts=${ts}`); },
      expectAuth: true, expectMethod: 'token',
      observed: { method: 'signed_link', verified: 'yes', matches: 'yes', email: null },
    },
    {
      name: 'MI session header',
      claim: U,
      build: () => req('/api/app/chat', { headers: { 'x-mi-auth-token': createMIAuthSessionToken(U) } }),
      expectAuth: true, expectMethod: 'session',
      observed: { method: 'mi_session', verified: 'yes', matches: 'yes', email: null },
    },
    {
      name: 'plaintext cookie is refused (R1)',
      claim: U,
      build: () => req('/api/pipeline/stats', { cookie: `ma_access_email=${U}` }),
      expectAuth: false, expectMethod: undefined, expectError: 'Unauthorized - please sign in',
      observed: { method: 'none', verified: 'no', matches: 'n/a', email: null },
    },
    {
      name: 'claimed staff email with no proof is refused (R1)',
      claim: STAFF,
      build: () => req('/api/team/upgrade'),
      expectAuth: false, expectMethod: undefined, expectError: 'Unauthorized - please sign in',
      observed: { method: 'none', verified: 'no', matches: 'n/a', email: null },
    },
    {
      name: 'nothing at all',
      claim: U,
      build: () => req('/api/library'),
      expectAuth: false, expectMethod: undefined, expectError: 'Unauthorized - please sign in',
      observed: { method: 'none', verified: 'no', matches: 'n/a', email: null },
    },
    {
      name: 'cookie refused under requireStrongAuth',
      claim: U, options: { requireStrongAuth: true },
      build: () => req('/api/vault', { cookie: `ma_access_email=${U}` }),
      expectAuth: false, expectMethod: undefined, expectError: 'Strong authentication required — please sign in',
      observed: { method: 'none', verified: 'no', matches: 'n/a', email: null },
    },
    {
      name: 'staff claim refused under requireStrongAuth',
      claim: STAFF, options: { requireStrongAuth: true },
      build: () => req('/api/vault'),
      expectAuth: false, expectMethod: undefined, expectError: 'Strong authentication required — please sign in',
      observed: { method: 'none', verified: 'no', matches: 'n/a', email: null },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      if (c.supabaseEmail) {
        getUser.mockResolvedValue({ data: { user: { email: c.supabaseEmail, app_metadata: { provider: 'google' } } }, error: null });
      }
      const r = await verifyUserOwnsEmail(c.build(), c.claim, c.options);
      expect(r.authenticated).toBe(c.expectAuth);
      expect(r.method).toBe(c.expectMethod);
      if (c.expectError) expect(r.error).toBe(c.expectError);
      await flush();
      expect(written).toHaveLength(1);
      const o = written[0].o;
      expect(o.probe).toBe('verify_user_owns_email');
      expect(o.method).toBe(c.observed.method);
      expect(o.verifiedIdentityPresent).toBe(c.observed.verified);
      expect(o.claimedMatchesIdentity).toBe(c.observed.matches);
      expect(o.email).toBe(c.observed.email);
    });
  }

  it('AUTH_OBSERVE=off writes nothing and still returns the same result', async () => {
    process.env.AUTH_OBSERVE = 'off';
    try {
      const r = await verifyUserOwnsEmail(req('/api/x', { headers: { 'x-mi-auth-token': createMIAuthSessionToken(U) } }), U);
      expect(r).toEqual({ authenticated: true, email: U, method: 'session' });
      await flush();
      expect(written).toHaveLength(0);
    } finally {
      delete process.env.AUTH_OBSERVE;
    }
  });
});

// ─── 3. never throws, never blocks ─────────────────────────────────────────

describe('logger failure is invisible to the caller', () => {
  it('a rejecting writer (DB down) does not throw or change the result', async () => {
    obs.__setObservationWriterForTests(async () => { throw new Error('connect ECONNREFUSED'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await verifyUserOwnsEmail(req('/api/x', { headers: { 'x-mi-auth-token': createMIAuthSessionToken('a@b.com') } }), 'a@b.com');
    expect(r).toEqual({ authenticated: true, email: 'a@b.com', method: 'session' });
    await flush();
    warn.mockRestore();
  });

  it('a writer that throws synchronously does not throw', async () => {
    obs.__setObservationWriterForTests(() => { throw new Error('sync boom'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => obs.recordAuthObservation({
      probe: 'pro_gate', route: '/x', method: 'none', verifiedIdentityPresent: 'no', claimedMatchesIdentity: 'n/a', email: null,
    })).not.toThrow();
    await flush();
    warn.mockRestore();
  });

  it('the default writer with no DB configured does not throw', async () => {
    obs.__setObservationWriterForTests(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => obs.observeProGateIdentity(req('/api/app/pricing-intel?email=a@b.com'), 'a@b.com')).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    warn.mockRestore();
  });

  it('a malformed request object does not throw', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => obs.observeVerifyResult({} as any, 'a@b.com', { authenticated: false })).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => obs.observeProGateIdentity({} as any, 'a@b.com')).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => obs.observeFederalContactsUsage({} as any, 'a@b.com')).not.toThrow();
  });

  it('the write is deferred — nothing is written synchronously', () => {
    obs.recordAuthObservation({
      probe: 'pro_gate', route: '/x', method: 'none', verifiedIdentityPresent: 'no', claimedMatchesIdentity: 'n/a', email: null,
    });
    expect(written).toHaveLength(0);
  });
});

// ─── 4. aggregation keys ───────────────────────────────────────────────────

describe('aggregation keys', () => {
  it('normalizeRoute collapses record ids so dynamic routes aggregate', () => {
    expect(obs.normalizeRoute('/api/app/chat-sessions/3f2a1b4c-1111-2222-3333-444455556666')).toBe('/api/app/chat-sessions/:id');
    expect(obs.normalizeRoute('/api/library/12345')).toBe('/api/library/:id');
    expect(obs.normalizeRoute('/api/x/a@b.com')).toBe('/api/x/:id');
    expect(obs.normalizeRoute('/api/app/pricing-intel')).toBe('/api/app/pricing-intel');
    expect(obs.normalizeRoute(undefined)).toBe('unknown');
    expect(obs.normalizeRoute('/a/' + 'b'.repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it('observationDay is the UTC calendar day', () => {
    expect(obs.observationDay(new Date('2026-09-26T23:59:59Z'))).toBe('2026-09-26');
    expect(obs.observationDay(new Date('2026-09-27T00:00:01Z'))).toBe('2026-09-27');
  });

  it('emails are recorded only for weak methods, unauthenticated pro-gate calls and E6 usage', () => {
    for (const m of ['supabase', 'signed_link', 'mi_session', 'none']) {
      expect(obs.shouldRecordEmail('verify_user_owns_email', m, 'no')).toBe(false);
    }
    expect(obs.shouldRecordEmail('verify_user_owns_email', 'cookie', 'no')).toBe(true);
    expect(obs.shouldRecordEmail('verify_user_owns_email', 'staff_claim', 'no')).toBe(true);
    expect(obs.shouldRecordEmail('pro_gate', 'none', 'no')).toBe(true);
    expect(obs.shouldRecordEmail('pro_gate', 'cookie', 'no')).toBe(true);
    expect(obs.shouldRecordEmail('pro_gate', 'mi_session', 'yes')).toBe(false);
    expect(obs.shouldRecordEmail('federal_contacts_usage', 'listing', 'yes')).toBe(true);
  });

  it('pro-gate: verified + matching / verified + mismatched / unverified / no claim', () => {
    expect(obs.buildProGateObservation('/r', 'a@b.com', { method: 'mi_session', email: 'a@b.com' }))
      .toMatchObject({ method: 'mi_session', verifiedIdentityPresent: 'yes', claimedMatchesIdentity: 'yes', email: null });
    expect(obs.buildProGateObservation('/r', 'victim@b.com', { method: 'supabase', email: 'attacker@b.com' }))
      .toMatchObject({ verifiedIdentityPresent: 'yes', claimedMatchesIdentity: 'no', email: null });
    expect(obs.buildProGateObservation('/r', 'a@b.com', { method: 'none', email: null }))
      .toMatchObject({ verifiedIdentityPresent: 'no', claimedMatchesIdentity: 'n/a', email: 'a@b.com' });
    expect(obs.buildProGateObservation('/r', 'a@b.com', { method: 'cookie', email: null }))
      .toMatchObject({ method: 'cookie', verifiedIdentityPresent: 'no', email: 'a@b.com' });
    expect(obs.buildProGateObservation('/r', null, { method: 'none', email: null }))
      .toMatchObject({ claimedMatchesIdentity: 'n/a', email: null });
  });

  it('pro-gate probe end-to-end: resolves an MI session from headers after the response', async () => {
    const t = createMIAuthSessionToken('real@b.com');
    obs.observeProGateIdentity(req('/api/app/pricing-intel?email=real@b.com', { headers: { 'x-mi-auth-token': t } }), 'real@b.com');
    await flush(); await flush();
    expect(written).toHaveLength(1);
    expect(written[0].o).toMatchObject({ probe: 'pro_gate', route: '/api/app/pricing-intel', method: 'mi_session', verifiedIdentityPresent: 'yes', claimedMatchesIdentity: 'yes', email: null });
  });

  it('pro-gate probe end-to-end: a spoofed ?email with no identity records the claimed email', async () => {
    obs.observeProGateIdentity(req('/api/app/competitor-awards?email=Payer@B.com'), 'Payer@B.com');
    await flush(); await flush();
    expect(written[0].o).toMatchObject({ method: 'none', verifiedIdentityPresent: 'no', email: 'payer@b.com' });
  });

  it('resolveVerifiedIdentity: supabase bearer, signed link, cookie, none', async () => {
    const d = { verifyMi: () => ({ valid: false }), supabaseEmail: async () => 'S@b.com' };
    expect(await obs.resolveVerifiedIdentity({ miToken: null, bearer: 'jwt', linkToken: null, linkTs: null, cookieEmail: null }, 'x@b.com', d))
      .toEqual({ method: 'supabase', email: 's@b.com' });
    const { token, ts } = signedLink('x@b.com');
    const none = { verifyMi: () => ({ valid: false }), supabaseEmail: async () => null };
    expect(await obs.resolveVerifiedIdentity({ miToken: null, bearer: null, linkToken: token, linkTs: String(ts), cookieEmail: null }, 'x@b.com', none))
      .toEqual({ method: 'signed_link', email: 'x@b.com' });
    expect(await obs.resolveVerifiedIdentity({ miToken: null, bearer: null, linkToken: null, linkTs: null, cookieEmail: 'X@b.com' }, 'x@b.com', none))
      .toEqual({ method: 'cookie', email: null });
    expect(await obs.resolveVerifiedIdentity({ miToken: null, bearer: 'bad', linkToken: null, linkTs: null, cookieEmail: null }, 'x@b.com', none))
      .toEqual({ method: 'none', email: null });
  });

  it('E6 federal-contacts usage classes', () => {
    const c = (q: string) => obs.classifyFederalContactsUsage(new URLSearchParams(q));
    expect(c('facets=agencies')).toBe('facet');
    expect(c('facets=offices&agency=DoD')).toBe('facet');
    expect(c('facets=office-roster&agency=DoD')).toBe('roster_index');
    expect(c('facets=office-roster&agency=DoD&office=NAVSUP')).toBe('roster_office');
    expect(c('agency=VA&limit=6')).toBe('listing');
    expect(c('dodaac=W912PL')).toBe('listing');
    expect(c('agency=VA')).toBe('browse');
    expect(c('agency=VA&limit=200')).toBe('bulk');
    expect(c('agency=VA&limit=50&offset=50')).toBe('bulk');
  });
});
