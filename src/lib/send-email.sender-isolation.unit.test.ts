import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Sender isolation (2026-10-27): Mindy product email goes out through Resend, from
 * mail.getmindy.ai, and nothing else. These pin it at the one provider boundary:
 *   - the default From is the verified Mindy domain;
 *   - a From on any other domain (govcongiants.com above all) is refused before the provider
 *     call, whether it comes from EMAIL_FROM or a caller override — even for transactional mail;
 *   - a Resend failure throws a typed error, makes exactly one provider attempt and records no
 *     send (there is no second transport to fall back to);
 *   - no RESEND_API_KEY means an explicit failure, not a silent switch to another provider;
 *   - the signup flow can still tell a mistyped recipient (Resend 422) from an outage.
 */

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  return {
    resendSend: vi.fn(),
    inserts: [] as { table: string; row: Record<string, unknown> }[],
  };
});

vi.mock('resend', () => ({
  Resend: class { emails = { send: h.resendSend }; },
}));
vi.mock('@/lib/email/legacy-destination-guard', () => ({ assertNoLegacyDestinations: () => {} }));
vi.mock('@/lib/access-links', () => ({ createSecureAccessUrl: () => 'https://getmindy.ai/x' }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        gte: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return { error: null }; },
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      });
      return b;
    },
  }),
}));

import { sendEmail, senderDomain, UnapprovedSenderError, ResendSendError, MINDY_SENDER_DOMAINS } from './send-email';
import { isInvalidRecipientError } from '@/lib/mindy/signup-email';

const base = { to: 'user@corp.com', subject: 's', html: '<p>hi</p>' };
const sends = () => h.inserts.filter((i) => i.table === 'email_provider_sends');
const savedFrom = process.env.EMAIL_FROM;

beforeEach(() => {
  h.resendSend.mockReset().mockResolvedValue({ data: { id: 're_1' }, error: null });
  h.inserts.length = 0;
  delete process.env.EMAIL_FROM;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (savedFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = savedFrom;
});

describe('sender domain', () => {
  it('only mail.getmindy.ai is approved', () => {
    expect([...MINDY_SENDER_DOMAINS]).toEqual(['mail.getmindy.ai']);
  });

  it('parses the domain from both From shapes', () => {
    expect(senderDomain('Mindy <alerts@mail.getmindy.ai>')).toBe('mail.getmindy.ai');
    expect(senderDomain('"GovCon Giants" <alerts@GovConGiants.com>')).toBe('govcongiants.com');
    expect(senderDomain('alerts@mail.getmindy.ai')).toBe('mail.getmindy.ai');
    expect(senderDomain('not an address')).toBeNull();
  });

  it('default From is Mindy on mail.getmindy.ai, reply-to support@getmindy.ai', async () => {
    expect(await sendEmail({ ...base, emailType: 'daily_alert' })).toBe(true);
    const call = h.resendSend.mock.calls[0][0];
    expect(call.from).toBe('Mindy <alerts@mail.getmindy.ai>');
    expect(call.replyTo).toBe('support@getmindy.ai');
  });

  it('a caller override on mail.getmindy.ai is allowed (launch/FHC senders)', async () => {
    expect(await sendEmail({ ...base, from: 'Eric Coffie <alerts@mail.getmindy.ai>', transactional: true })).toBe(true);
    expect(h.resendSend).toHaveBeenCalledOnce();
  });

  it.each([
    ['caller override', { from: '"GovCon Giants" <alerts@govcongiants.com>' }],
    ['subdomain', { from: 'x@mail.govcongiants.com' }],
    ['unverified Mindy apex', { from: 'Mindy <hello@getmindy.ai>' }],
  ])('refuses %s before any provider call, even for transactional mail', async (_label, extra) => {
    await expect(sendEmail({ ...base, ...extra, emailType: 'mi_password_reset', transactional: true }))
      .rejects.toBeInstanceOf(UnapprovedSenderError);
    expect(h.resendSend).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(0);
  });

  it('refuses a govcongiants.com EMAIL_FROM (a bad env value cannot move Mindy mail)', async () => {
    process.env.EMAIL_FROM = 'alerts@govcongiants.com';
    await expect(sendEmail({ ...base, emailType: 'two_factor_code' })).rejects.toBeInstanceOf(UnapprovedSenderError);
    expect(h.resendSend).not.toHaveBeenCalled();
  });
});

describe('Resend failure: typed error, one attempt, no false success record', () => {
  it.each([
    ['403 unverified domain', { name: 'validation_error', statusCode: 403, message: 'domain not verified' }],
    ['429 rate limit', { name: 'rate_limit_exceeded', statusCode: 429, message: 'rate limited' }],
    ['500', { name: 'application_error', statusCode: 500, message: 'Internal server error' }],
    ['no response', { name: 'application_error', statusCode: null, message: 'Unable to fetch data.' }],
  ])('%s → ResendSendError', async (_label, error) => {
    h.resendSend.mockResolvedValue({ data: null, error });
    const err = await sendEmail({ ...base, emailType: 'daily_alert' }).catch((e) => e);
    expect(err).toBeInstanceOf(ResendSendError);
    expect((err as ResendSendError).statusCode).toBe(error.statusCode);
    expect(h.resendSend).toHaveBeenCalledOnce();
    expect(sends()).toHaveLength(0);
  });

  it('signup: a Resend 422 invalid `to` is a mistyped recipient; other Resend errors are not', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.' } });
    const bad = await sendEmail({ ...base, emailType: 'mindy_free_signup' }).catch((e) => e);
    expect(isInvalidRecipientError(bad)).toBe(true);

    h.resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Invalid `from` field.' } });
    expect(isInvalidRecipientError(await sendEmail({ ...base }).catch((e) => e))).toBe(false);
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'Invalid `to` field' } });
    expect(isInvalidRecipientError(await sendEmail({ ...base }).catch((e) => e))).toBe(false);
  });
});

describe('no RESEND_API_KEY', () => {
  it('throws an explicit provider-unavailable error; nothing is sent or recorded', async () => {
    vi.resetModules();
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const mod = await import('./send-email');
      await expect(mod.sendEmail({ ...base, transactional: true })).rejects.toThrow(/RESEND_API_KEY is not configured/);
      expect(h.resendSend).not.toHaveBeenCalled();
      expect(sends()).toHaveLength(0);
    } finally {
      process.env.RESEND_API_KEY = key;
    }
  });
});
