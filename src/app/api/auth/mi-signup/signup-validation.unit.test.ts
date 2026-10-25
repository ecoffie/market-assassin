/**
 * Route-level regression for the 2026-10-25 signup 500s (tasks/mindy-signup-500-investigation-2026-10-25.md).
 *
 * The auth account (and, via the DB trigger, its user_profiles row) is created by
 * supabase.auth.admin.generateLink({type:'invite'}). So "no account or profile was created" is
 * asserted as: generateLink was NEVER called. Supabase, DNS and the email sender are mocked;
 * no network, no real accounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const generateLink = vi.fn();
const insert = vi.fn();
const sendEmail = vi.fn();
const enqueuePendingSignup = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { generateLink } }, from: () => ({ insert }) }),
}));
vi.mock('dns/promises', () => ({ resolveMx: vi.fn(async () => [{ exchange: 'mx.example.com', priority: 10 }]) }));
vi.mock('@/lib/send-email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/resilience/signup-queue', () => ({ enqueuePendingSignup: (...a: unknown[]) => enqueuePendingSignup(...a) }));
vi.mock('@/lib/mindy/lead-attribution', () => ({
  normalizeAttribution: () => ({}),
  pushLeadToGhl: vi.fn(),
  isYouTubeSource: () => false,
}));

const { POST } = await import('../mindy-signup/route');

let n = 0;
const uniq = (local: string, domain = 'example.com') => `${local}${++n}@${domain}`; // rate limit is keyed per email
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('https://getmindy.ai/api/auth/mindy-signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
  }));

const SETUP_URL = 'https://auth.getmindy.ai/verify?token=TEST&type=invite';
const recipientRejected = () => Object.assign(new Error("Can't send mail - all recipients were rejected: 501 5.1.3 Invalid address"), {
  code: 'EENVELOPE', response: '501 5.1.3 Invalid address', responseCode: 501, command: 'RCPT TO',
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  delete process.env.MINDY_SKIP_MX_CHECK;
  generateLink.mockReset().mockResolvedValue({ data: { properties: { action_link: SETUP_URL } }, error: null });
  insert.mockReset().mockResolvedValue({ error: null });
  sendEmail.mockReset().mockResolvedValue(true);
  enqueuePendingSignup.mockReset().mockResolvedValue(true);
});

describe('Fix 1 — mistyped addresses are refused BEFORE any account exists', () => {
  it.each([
    ['consecutive dots (incident shape)', 'ab.cde..f.g'],
    ['leading dot', '.jane'],
    ['dot before the @', 'jane.'],
  ])('%s → 400, helpful message, generateLink never called, no email', async (_l, local) => {
    const res = await post({ email: `${local}@example${++n}.com` });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/looks mistyped/i);
    expect(generateLink).not.toHaveBeenCalled();   // no auth user → no user_profiles row
    expect(sendEmail).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();         // no signup_attribution row
    expect(enqueuePendingSignup).not.toHaveBeenCalled();
  });
});

describe('valid signup is unchanged', () => {
  it('200, invite link generated, welcome email carries that link to that address', async () => {
    const email = uniq('jane.doe');
    const res = await post({ email });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Check your inbox for a link to set up your account.' });
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink.mock.calls[0][0]).toMatchObject({ type: 'invite', email });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe(email);
    expect(sent.emailType).toBe('mindy_free_signup');
    expect(sent.html).toContain(SETUP_URL);
    expect(sent.text).toContain(SETUP_URL);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('existing user still falls back to a recovery link', async () => {
    generateLink
      .mockResolvedValueOnce({ data: null, error: { message: 'already registered' } })
      .mockResolvedValueOnce({ data: { properties: { action_link: SETUP_URL.replace('invite', 'recovery') } }, error: null });
    const res = await post({ email: uniq('existing') });
    expect(res.status).toBe(200);
    expect(generateLink.mock.calls.map((c) => c[0].type)).toEqual(['invite', 'recovery']);
    expect(sendEmail.mock.calls[0][0].tags.link).toBe('recovery');
  });

  it('DB outage still queues the signup (unchanged)', async () => {
    generateLink.mockRejectedValue(new Error('connection refused'));
    const res = await post({ email: uniq('queued') });
    expect(res.status).toBe(200);
    expect((await res.json()).queued).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('Fix 2 — a provider recipient rejection is a 400, not a 500', () => {
  it('both providers reject the recipient (the production error) → 400 mistyped', async () => {
    sendEmail.mockRejectedValue(recipientRejected());
    const res = await post({ email: uniq('typo') });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: expect.stringMatching(/looks mistyped/i) });
    expect(insert).not.toHaveBeenCalled(); // attribution is not recorded for a failed signup
  });
});

describe('provider outages remain server errors', () => {
  it.each([
    ['SMTP timeout (no reply)', Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' })],
    ['SMTP auth failure', Object.assign(new Error('535'), { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 535, response: '535 5.7.3 Authentication unsuccessful' })],
    ['rate limited (452 at RCPT)', Object.assign(new Error('452'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 452, response: '452 4.5.3 Too many recipients' })],
    ['policy rejection (550 5.7.1 at RCPT)', Object.assign(new Error('550'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 5.7.1 Relaying denied' })],
    ['generic error', new Error('Internal server error')],
  ])('%s → 500 "Unable to create account"', async (_l, err) => {
    sendEmail.mockRejectedValue(err);
    const res = await post({ email: uniq('outage') });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Unable to create account' });
  });
});
