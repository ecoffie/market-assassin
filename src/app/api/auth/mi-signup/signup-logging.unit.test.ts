/**
 * Signup logging repair (activation Phase 1, 2026-11-14).
 *
 * Before: /api/auth/mindy-signup (the /app + Opportunity Map signup door) logged nothing, and save-profile logged
 * every signed-out re-save by an EXISTING account as a failed signup (all 135 October-November "failures").
 * These tests pin: each signup outcome logs exactly one honest event, a returning address is never counted as a
 * new signup, and the account_verified registration record is written once per new account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const generateLink = vi.fn();
const sendEmail = vi.fn();
const enqueuePendingSignup = vi.fn();
const logSignupEvent = vi.fn(async () => null);
const logSignupFailed = vi.fn(async () => null);
const logExistingAccountRedirect = vi.fn(async () => null);

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { generateLink } }, from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock('dns/promises', () => ({ resolveMx: vi.fn(async () => [{ exchange: 'mx.example.com', priority: 10 }]) }));
vi.mock('@/lib/send-email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/resilience/signup-queue', () => ({ enqueuePendingSignup: (...a: unknown[]) => enqueuePendingSignup(...a) }));
vi.mock('@/lib/mindy/lead-attribution', () => ({ normalizeAttribution: () => ({}), pushLeadToGhl: vi.fn(), isYouTubeSource: () => false }));
vi.mock('@/lib/signup-events', async (orig) => ({
  ...(await orig<typeof import('@/lib/signup-events')>()),
  logSignupEvent: (...a: unknown[]) => logSignupEvent(...(a as [])),
  logSignupFailed: (...a: unknown[]) => logSignupFailed(...(a as [])),
  logExistingAccountRedirect: (...a: unknown[]) => logExistingAccountRedirect(...(a as [])),
}));

const { POST } = await import('../mindy-signup/route');
const { accountVerifiedDecision, recordAccountVerified, SignupEventType } = await vi.importActual<typeof import('@/lib/signup-events')>('@/lib/signup-events');

let n = 0;
const uniq = () => `person${++n}@example.com`;
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('https://getmindy.ai/api/auth/mindy-signup', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
  }));
const link = (type: 'invite' | 'recovery') => ({ data: { properties: { action_link: `https://auth.getmindy.ai/verify?type=${type}` } }, error: null });
const eventTypes = () => (logSignupEvent.mock.calls as unknown as Array<[{ eventType: string }]>).map(([e]) => e.eventType);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.MINDY_SKIP_MX_CHECK = 'true';
  generateLink.mockReset().mockResolvedValue(link('invite'));
  sendEmail.mockReset().mockResolvedValue(true);
  enqueuePendingSignup.mockReset().mockResolvedValue(true);
  logSignupEvent.mockClear(); logSignupFailed.mockClear(); logExistingAccountRedirect.mockClear();
});

describe('mindy-signup logs the funnel', () => {
  it('a new account logs started then completed (link_type invite), no failure', async () => {
    const res = await post({ email: uniq(), source: 'opportunity_map' });
    expect(res.status).toBe(200);
    expect(eventTypes()).toEqual([SignupEventType.SIGNUP_STARTED, SignupEventType.SIGNUP_COMPLETED]);
    const completed = (logSignupEvent.mock.calls as unknown as Array<[{ source: string; metadata: Record<string, unknown> }]>)[1][0];
    expect(completed.source).toBe('opportunity_map');
    expect(completed.metadata.link_type).toBe('invite');
    expect(logSignupFailed).not.toHaveBeenCalled();
    expect(logExistingAccountRedirect).not.toHaveBeenCalled();
  });

  it('an address that already has an account (recovery link) is NOT counted as a new signup', async () => {
    generateLink.mockReset()
      .mockResolvedValueOnce({ data: null, error: { message: 'already registered' } })
      .mockResolvedValueOnce(link('recovery'));
    const res = await post({ email: uniq() });
    expect(res.status).toBe(200);
    expect(eventTypes()).toEqual([SignupEventType.SIGNUP_STARTED]);
    expect(logExistingAccountRedirect).toHaveBeenCalledTimes(1);
    expect(logSignupFailed).not.toHaveBeenCalled();
  });

  it('a validation refusal logs a failure and no completion', async () => {
    const res = await post({ email: 'jane..doe@example.com' });
    expect(res.status).toBe(400);
    expect(logSignupFailed).toHaveBeenCalledTimes(1);
    expect(eventTypes()).not.toContain(SignupEventType.SIGNUP_COMPLETED);
  });

  it('a missing email logs a failure', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(logSignupFailed).toHaveBeenCalledTimes(1);
  });

  it('a database outage that queues the signup logs a queued completion, not a failure', async () => {
    generateLink.mockReset().mockRejectedValue(new Error('db down'));
    const res = await post({ email: uniq() });
    expect((await res.json()).queued).toBe(true);
    const completed = (logSignupEvent.mock.calls as unknown as Array<[{ eventType: string; metadata?: Record<string, unknown> }]>)
      .map(([e]) => e).find((e) => e.eventType === SignupEventType.SIGNUP_COMPLETED);
    expect(completed?.metadata?.queued).toBe(true);
    expect(logSignupFailed).not.toHaveBeenCalled();
  });

  it('logging never changes the response when the logger rejects', async () => {
    logSignupEvent.mockRejectedValueOnce(new Error('logger down') as never);
    const res = await post({ email: uniq() });
    expect(res.status).toBe(200);
  });
});

describe('account_verified: one registration record per new account', () => {
  const NOW = new Date('2026-11-14T12:00:00Z');

  it('decision: only real emails on recently created accounts are recorded', () => {
    expect(accountVerifiedDecision('a@b.com', '2026-11-10T00:00:00Z', NOW)).toBe('record');
    expect(accountVerifiedDecision('a@b.com', '2026-09-01T00:00:00Z', NOW)).toBe('outside_window');
    expect(accountVerifiedDecision('a@b.com', null, NOW)).toBe('unknown_created_at');
    expect(accountVerifiedDecision('anon:123', '2026-11-10T00:00:00Z', NOW)).toBe('invalid_email');
    expect(accountVerifiedDecision('', '2026-11-10T00:00:00Z', NOW)).toBe('invalid_email');
  });

  function fakeDb(opts: { prior?: boolean; lookupError?: string; insertError?: { code?: string; message: string } }) {
    const inserts: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ limit: async () => (opts.lookupError
          ? { data: null, error: { message: opts.lookupError } }
          : { data: opts.prior ? [{ id: 'x' }] : [], error: null }) }) }) }),
        insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: opts.insertError ?? null }; },
      }),
    };
    return { db: db as never, inserts };
  }
  const p = { email: 'New.Person@Example.com', accountCreatedAt: '2026-11-13T00:00:00Z', channel: 'email_setup' };

  it('first verified sign-in writes one row with the channel', async () => {
    const { db, inserts } = fakeDb({});
    expect(await recordAccountVerified(p, { db, now: NOW })).toBe('recorded');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ event_type: 'account_verified', user_email: 'new.person@example.com', source: 'email_setup' });
  });

  it('a later sign-in finds the prior row and writes nothing', async () => {
    const { db, inserts } = fakeDb({ prior: true });
    expect(await recordAccountVerified(p, { db, now: NOW })).toBe('already_recorded');
    expect(inserts).toHaveLength(0);
  });

  it('a concurrent duplicate (unique index 23505) is already recorded, not an error', async () => {
    const { db } = fakeDb({ insertError: { code: '23505', message: 'duplicate key' } });
    expect(await recordAccountVerified(p, { db, now: NOW })).toBe('already_recorded');
  });

  it('a failed lookup is an error and writes nothing (never guesses)', async () => {
    const { db, inserts } = fakeDb({ lookupError: 'timeout' });
    expect(await recordAccountVerified(p, { db, now: NOW })).toBe('error');
    expect(inserts).toHaveLength(0);
  });

  it('an old account never reaches the database', async () => {
    const { db, inserts } = fakeDb({});
    expect(await recordAccountVerified({ ...p, accountCreatedAt: '2025-01-01T00:00:00Z' }, { db, now: NOW })).toBe('outside_window');
    expect(inserts).toHaveLength(0);
  });
});
