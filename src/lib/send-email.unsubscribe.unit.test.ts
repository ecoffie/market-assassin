/**
 * One-click unsubscribe at the provider boundary (Eric 2026-11-27): every NON-transactional send carries RFC 8058
 * List-Unsubscribe headers and the footer placeholder becomes the recipient's signed link; transactional mail has
 * no unsubscribe headers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.EMAIL_ACTION_SECRET = 'test-secret';
  return { resendSend: vi.fn(async (_p: Record<string, unknown>) => ({ data: { id: 'msg_1' }, error: null })) };
});
vi.mock('resend', () => ({ Resend: class { emails = { send: h.resendSend }; } }));
vi.mock('@/lib/email/legacy-destination-guard', () => ({ assertNoLegacyDestinations: () => {} }));
vi.mock('@/lib/access-links', () => ({ createSecureAccessUrl: () => 'https://getmindy.ai/x' }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, gte: () => b, eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      });
      return b;
    },
  }),
}));

import { sendEmail } from './send-email';
import { UNSUBSCRIBE_URL_PLACEHOLDER, verifyUnsubscribe } from './email/unsubscribe';

const sent = () => h.resendSend.mock.calls.at(-1)![0] as { headers: Record<string, string>; html: string; text: string };

beforeEach(() => h.resendSend.mockClear());

describe('sendEmail — one-click unsubscribe', () => {
  it('a daily alert carries List-Unsubscribe (https, signed for THIS recipient) + List-Unsubscribe-Post', async () => {
    await sendEmail({ to: 'Pat@Example.com', subject: 's', html: `<a href="${UNSUBSCRIBE_URL_PLACEHOLDER}">Unsubscribe</a>`, emailType: 'daily_alert' });
    const p = sent();
    expect(p.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url = p.headers['List-Unsubscribe'].match(/^<(https:\/\/[^>]+)>$/)![1];
    const u = new URL(url);
    expect(u.pathname).toBe('/api/unsubscribe');
    expect(verifyUnsubscribe(u.searchParams.get('e'), u.searchParams.get('t'))).toBe('pat@example.com');
    expect(p.html).not.toContain(UNSUBSCRIBE_URL_PLACEHOLDER);
    expect(p.html).toContain('/api/unsubscribe?e=');
    expect(p.html).toContain('&amp;t='); // HTML-escaped inside the href
  });
  it('the plain-text body gets the unescaped link', async () => {
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>', text: `Unsubscribe: ${UNSUBSCRIBE_URL_PLACEHOLDER}`, emailType: 'weekly_alert' });
    expect(sent().text).toMatch(/Unsubscribe: https:\/\/getmindy\.ai\/api\/unsubscribe\?e=[^&]+&t=[0-9a-f]{64}/);
  });
  it('transactional mail (password reset / 2FA / receipt) carries no unsubscribe headers', async () => {
    for (const emailType of ['mi_password_reset', 'two_factor_code', 'purchase_receipt']) {
      await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>', emailType });
      expect(sent().headers['List-Unsubscribe']).toBeUndefined();
    }
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>', transactional: true });
    expect(sent().headers['List-Unsubscribe']).toBeUndefined();
  });
  it('an email with no type is treated as non-transactional (gets the headers)', async () => {
    await sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });
    expect(sent().headers['List-Unsubscribe']).toMatch(/^<https:/);
  });
});
