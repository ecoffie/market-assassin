import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Mindy Launch confirmation endpoint must say what actually happened (2026-10-10).
 *
 * govcongiants.com /api/lead hands every mindy-launch registration to this endpoint. It
 * used to answer 200 `{ ok: false }` when the send guard blocked the email and 200
 * `{ ok: true }` without saying which provider took it, so the caller could only guess
 * from the HTTP code. These tests drive the real route, the real confirmation builder
 * and the real sendEmail with only the providers and database mocked. They pin:
 *   1. `accepted` only when a provider accepted the message, with provider + message id.
 *   2. A provider failure is 502 `failed`; a guard block is 422 `blocked`; neither sends.
 *   3. One request makes at most one successful provider send — no internal retry —
 *      so the endpoint can't be the source of a duplicate confirmation.
 */

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.CRON_SECRET = 'cron-test-secret';
  return {
    resendSend: vi.fn(),
    smtpSend: vi.fn(),
    inserts: [] as { table: string; row: Record<string, unknown> }[],
  };
});

vi.mock('resend', () => ({
  Resend: class { emails = { send: h.resendSend }; },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: h.smtpSend }) },
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

import { POST } from './route';

function req(body: Record<string, unknown>, auth = 'Bearer cron-test-secret') {
  return new NextRequest('https://getmindy.ai/api/mindy-launch/send-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

const REGISTRANT = { email: 'jane@acme.co', name: 'Jane Doe' };
const providerCalls = () => h.resendSend.mock.calls.length + h.smtpSend.mock.calls.length;

beforeEach(() => {
  h.resendSend.mockReset().mockResolvedValue({ data: { id: 're_msg_1' }, error: null });
  h.smtpSend.mockReset().mockResolvedValue({ messageId: '<smtp-1@o365>' });
  h.inserts.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('send-confirmation reports provider acceptance, not just an HTTP code', () => {
  it('Resend accepts: 200 accepted with provider and message id, one send', async () => {
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'accepted', provider: 'resend', providerMessageId: 're_msg_1' });
    expect(h.resendSend).toHaveBeenCalledOnce();
    expect(h.smtpSend).not.toHaveBeenCalled();
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(1);
  });

  it('Resend rejects, Office365 accepts: 200 accepted via office365, exactly one accepted send', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'accepted', provider: 'office365', providerMessageId: '<smtp-1@o365>' });
    expect(h.smtpSend).toHaveBeenCalledOnce();
  });

  it('both providers fail: 502 failed, never accepted', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    h.smtpSend.mockRejectedValue(new Error('SMTP auth failed'));
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: 'failed', error: 'SMTP auth failed' });
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(0);
  });

  it('guard block: 422 blocked with the reason, zero provider calls', async () => {
    const res = await POST(req({ email: 'ws_123@clients.getmindy.ai', name: 'X' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, status: 'blocked', reason: 'synthetic_client_address' });
    expect(providerCalls()).toBe(0);
  });

  it('unauthorized: 401, zero provider calls', async () => {
    const res = await POST(req(REGISTRANT, 'Bearer wrong'));
    expect(res.status).toBe(401);
    expect(providerCalls()).toBe(0);
  });

  it('the endpoint never retries a send itself', async () => {
    // A slow-but-successful Resend call must still produce exactly one send.
    h.resendSend.mockImplementation(() => new Promise((r) => setTimeout(() => r({ data: { id: 're_slow' }, error: null }), 30)));
    const res = await POST(req(REGISTRANT));
    expect((await res.json()).providerMessageId).toBe('re_slow');
    expect(providerCalls()).toBe(1);
  });
});
