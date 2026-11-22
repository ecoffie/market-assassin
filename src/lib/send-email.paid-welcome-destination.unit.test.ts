import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Paid welcome email destinations (2026-11-22).
 *
 * A customer who has just PAID must land in the product, not on /market-intelligence:
 * that page is an upgrade page (plan cards + Stripe trial links) whose email box routes to
 * legacy /briefings. The main CTA goes to the Map with UTM tags so the email's effect on
 * activation is measurable.
 *
 * Checked on what the real senders hand the provider (resend.emails.send), i.e. the call
 * sites the Stripe webhooks use: sendMarketIntelligenceWelcomeEmail and sendBundleEmail.
 */

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  return {
    resendSend: vi.fn(async (_: { html: string; text: string }) => ({ data: { id: 'msg_1' }, error: null })),
  };
});

vi.mock('resend', () => ({
  Resend: class { emails = { send: h.resendSend }; },
}));
vi.mock('@/lib/access-links', () => ({
  createSecureAccessUrl: (email: string) => `https://getmindy.ai/alerts/preferences?email=${encodeURIComponent(email)}`,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        gte: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      });
      return b;
    },
  }),
}));

import { sendMarketIntelligenceWelcomeEmail, sendBundleEmail } from './send-email';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';

function lastPayload() {
  expect(h.resendSend).toHaveBeenCalledTimes(1);
  return h.resendSend.mock.calls[0][0];
}

function hrefsIn(html: string): URL[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&')));
}

beforeEach(() => h.resendSend.mockClear());

describe('paid Mindy AI welcome email', () => {
  it('main "Open Mindy AI" button opens the Map with UTM tags, not the upgrade page', async () => {
    expect(await sendMarketIntelligenceWelcomeEmail({ to: 'buyer@corp.com', customerName: 'Maria' })).toBe(true);
    const p = lastPayload();
    const m = p.html.match(/<a href="([^"]+)"[^>]*>Open Mindy AI<\/a>/);
    expect(m).not.toBeNull();
    const u = new URL(m![1].replace(/&amp;/g, '&'));
    expect(u.origin + u.pathname).toBe('https://getmindy.ai/opportunity-map');
    expect(u.searchParams.get('utm_source')).toBe('resend');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('utm_campaign')).toBe('paid_welcome');
    expect(u.searchParams.get('utm_content')).toBe('open_mindy');
  });

  it('no link (html or text) points at /market-intelligence or a legacy surface', async () => {
    await sendMarketIntelligenceWelcomeEmail({ to: 'buyer@corp.com' });
    const p = lastPayload();
    expect(p.html).not.toContain('/market-intelligence');
    expect(p.text).not.toContain('/market-intelligence');
    expect(p.text).toContain('https://getmindy.ai/opportunity-map?utm_source=resend');
    expect(findLegacyDestinations(p.html, p.text)).toEqual([]);
  });

  it('keeps the briefing-preferences setup link', async () => {
    await sendMarketIntelligenceWelcomeEmail({ to: 'buyer@corp.com' });
    const p = lastPayload();
    expect(hrefsIn(p.html).some((u) => u.pathname === '/alerts/preferences')).toBe(true);
  });
});

describe('bundle email: the "Mindy AI" row', () => {
  it.each(['pro', 'pro-giant-bundle', 'ultimate', 'ultimate-govcon-bundle'])(
    '%s bundle links Mindy AI to the Map with UTM tags, never /market-intelligence',
    async (bundle) => {
      expect(await sendBundleEmail({ to: 'buyer@corp.com', bundle })).toBe(true);
      const p = lastPayload();
      expect(p.html).not.toContain('/market-intelligence');
      expect(p.text).not.toContain('/market-intelligence');
      const mindy = p.html.match(/<a href="([^"]+)"[^>]*>Mindy AI - [^<]+<\/a>/);
      expect(mindy).not.toBeNull();
      const u = new URL(mindy![1].replace(/&amp;/g, '&'));
      expect(u.pathname).toBe('/opportunity-map');
      expect(u.searchParams.get('utm_campaign')).toBe('bundle_welcome');
      expect(u.searchParams.get('utm_content')).toBe(bundle);
      expect(findLegacyDestinations(p.html, p.text)).toEqual([]);
    },
  );
});
