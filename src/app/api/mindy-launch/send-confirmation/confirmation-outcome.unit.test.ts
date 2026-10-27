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
 *   2. An EXPLICIT Resend rejection (4xx) is 502 `failed`; a guard block is 422
 *      `blocked`. A provider outcome we can't see (no response, 5xx, SDK throw) is 500
 *      `unconfirmed` — never `failed`.
 *   3. Resend is the only provider (sender isolation, 2026-10-27): no failure ever reaches
 *      a second transport, so one request makes exactly one provider attempt. Nothing
 *      here deduplicates ACROSS requests; that needs a durable store (follow-up).
 */

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.CRON_SECRET = 'cron-test-secret';
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

import { POST } from './route';

function req(body: Record<string, unknown>, auth = 'Bearer cron-test-secret') {
  return new NextRequest('https://getmindy.ai/api/mindy-launch/send-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

const REGISTRANT = { email: 'jane@acme.co', name: 'Jane Doe' };
const providerCalls = () => h.resendSend.mock.calls.length;

beforeEach(() => {
  h.resendSend.mockReset().mockResolvedValue({ data: { id: 're_msg_1' }, error: null });
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
    expect(h.resendSend.mock.calls[0][0].from).toBe('"Mindy" <mindy@mail.getmindy.ai>');
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(1);
  });

  it('Resend explicitly rejects (403): 502 failed, no fallback, no send record', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 403, message: 'domain not verified' } });
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, status: 'failed' });
    expect(providerCalls()).toBe(1);
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(0);
  });

  it('Resend rate-limits (429): 502 failed, never accepted', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'rate limited' } });
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, status: 'failed' });
    expect(providerCalls()).toBe(1);
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(0);
  });
});

describe('an unknown provider outcome is unconfirmed, never failed, and never falls back', () => {
  // The exact shape Resend SDK 6.x returns when fetch throws (network error, timeout,
  // lost response): it never throws, so this is indistinguishable from "not sent"
  // unless the status code is checked.
  const NO_RESPONSE = { name: 'application_error', statusCode: null, message: 'Unable to fetch data. The request could not be resolved.' };

  it('Resend gives no response: 500 unconfirmed, nothing else tried (Resend may have accepted)', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: NO_RESPONSE });
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: 'unconfirmed' });
    expect(body.error).toMatch(/^outcome unknown at resend: no response/);
    expect(providerCalls()).toBe(1);
  });

  it('Resend 5xx: 500 unconfirmed, nothing else tried', async () => {
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', statusCode: 500, message: 'Internal server error' } });
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(500);
    expect((await res.json()).status).toBe('unconfirmed');
    expect(providerCalls()).toBe(1);
  });

  it('Resend SDK throws (unexpected): 500 unconfirmed, nothing else tried', async () => {
    h.resendSend.mockRejectedValue(new Error('socket hang up'));
    const res = await POST(req(REGISTRANT));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('unconfirmed');
    expect(body.error).toMatch(/^outcome unknown at resend: threw: socket hang up/);
    expect(providerCalls()).toBe(1);
  });
});

describe('guard, auth and retry', () => {
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

describe('every stream: Resend failure never reaches a second transport', () => {
  it('without strictOutcome, a no-response Resend result throws instead of falling back', async () => {
    const { sendEmail, ResendSendError } = await import('@/lib/send-email');
    h.resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', statusCode: null, message: 'Unable to fetch data.' } });
    await expect(sendEmail({ to: 'jane@acme.co', subject: 's', html: '<p>x</p>', transactional: true })).rejects.toBeInstanceOf(ResendSendError);
    expect(providerCalls()).toBe(1);
    expect(h.inserts.filter((i) => i.table === 'email_provider_sends')).toHaveLength(0);
  });
});
