import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * sendEmail() is the ONE provider boundary. These tests pin the P0 semantics there:
 *   - a mailbox in email_suppressions gets ZERO provider attempts for product/alert mail;
 *   - user-initiated transactional/auth mail is NOT blocked by mailbox suppression;
 *   - the product preference (alerts_enabled) is never consulted by sendEmail at all,
 *     so turning alerts off cannot block a password reset.
 */

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  return {
    resendSend: vi.fn(async () => ({ data: { id: 'msg_1' }, error: null })),
    smtpSend: vi.fn(async () => ({})),
    suppressed: new Set<string>(),
    tablesRead: [] as string[],
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
      h.tablesRead.push(table);
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        gte: () => b,
        eq: (col: string, val: unknown) => { filters[col] = val; return b; },
        maybeSingle: async () => ({
          data: table === 'email_suppressions' && h.suppressed.has(String(filters.user_email))
            ? { reason: 'hard_bounce' } : null,
          error: null,
        }),
        insert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      });
      return b;
    },
  }),
}));

import { sendEmail } from './send-email';

const base = { subject: 's', html: '<p>hi</p>' };

beforeEach(() => {
  h.resendSend.mockClear();
  h.smtpSend.mockClear();
  h.suppressed.clear();
  h.tablesRead.length = 0;
});

describe('sendEmail — mailbox suppression at the provider boundary', () => {
  it('suppressed recipient: a daily alert makes ZERO provider attempts', async () => {
    h.suppressed.add('dead@corp.com');
    const ok = await sendEmail({ ...base, to: 'Dead@Corp.com', emailType: 'daily_alert' });
    expect(ok).toBe(false);
    expect(h.resendSend).not.toHaveBeenCalled();
    expect(h.smtpSend).not.toHaveBeenCalled();
  });

  it('suppressed recipient: weekly, saved-search, briefing and marketing mail are all blocked', async () => {
    h.suppressed.add('dead@corp.com');
    for (const emailType of ['weekly_alert', 'saved_search_alert', 'pursuit_change_alert', undefined, 'upgrade_drip_d1']) {
      expect(await sendEmail({ ...base, to: 'dead@corp.com', emailType })).toBe(false);
    }
    expect(h.resendSend).not.toHaveBeenCalled();
  });

  it('legitimate deliverable recipient still receives the alert', async () => {
    const ok = await sendEmail({ ...base, to: 'live@corp.com', emailType: 'daily_alert' });
    expect(ok).toBe(true);
    expect(h.resendSend).toHaveBeenCalledTimes(1);
  });

  it('password reset / 2FA are NOT blocked by mailbox suppression', async () => {
    h.suppressed.add('user@corp.com');
    expect(await sendEmail({ ...base, to: 'user@corp.com', emailType: 'mi_password_reset' })).toBe(true);
    expect(await sendEmail({ ...base, to: 'user@corp.com', emailType: 'two_factor_code' })).toBe(true);
    expect(await sendEmail({ ...base, to: 'user@corp.com', transactional: true })).toBe(true);
    expect(h.resendSend).toHaveBeenCalledTimes(3);
  });

  it('the product preference is never read by sendEmail (alerts_enabled cannot block security mail)', async () => {
    await sendEmail({ ...base, to: 'user@corp.com', emailType: 'mi_password_reset' });
    await sendEmail({ ...base, to: 'user@corp.com', emailType: 'daily_alert' });
    expect(h.tablesRead).not.toContain('user_notification_settings');
  });
});
