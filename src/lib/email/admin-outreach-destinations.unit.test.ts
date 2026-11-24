/**
 * Admin-triggered customer emails must not send readers to the legacy /briefings, and their
 * main button must carry UTM tags (2026-11-22). Covers the URL helpers AND the two call sites:
 * the feedback outreach is rendered through its real POST handler; the treatment-upgrade
 * template is checked at its href in the route source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findLegacyDestinations } from './legacy-destination-guard';
import { feedbackOutreachPreferencesUrl, treatmentUpgradeDashboardUrl } from './admin-outreach-destinations';

const sendEmail = vi.fn(async (_opts: { to: string; subject: string; html: string }) => ({ success: true }));
vi.mock('@/lib/send-email', () => ({ sendEmail: (opts: { to: string; subject: string; html: string }) => sendEmail(opts) }));

const insert = vi.fn(async () => ({ error: null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'user_notification_settings') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { user_email: 'pat@example.com', naics_codes: ['541512'] } }) }),
          }),
        };
      }
      return { insert };
    },
  }),
}));

describe('feedbackOutreachPreferencesUrl', () => {
  it('lands on the preferences page for this reader, with UTM tags', () => {
    const u = new URL(feedbackOutreachPreferencesUrl(' Pat@Example.com '));
    expect(u.origin + u.pathname).toBe('https://getmindy.ai/alerts/preferences');
    expect(u.searchParams.get('email')).toBe('pat@example.com');
    expect(u.searchParams.get('utm_source')).toBe('resend');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('utm_campaign')).toBe('feedback_outreach');
    expect(u.searchParams.get('utm_content')).toBe('update_preferences');
    expect(findLegacyDestinations(`<a href="${u.toString()}">x</a>`)).toEqual([]);
  });
});

describe('treatmentUpgradeDashboardUrl', () => {
  it('lands on the Map for this reader, with UTM tags', () => {
    const u = new URL(treatmentUpgradeDashboardUrl('pat@example.com'));
    expect(u.origin + u.pathname).toBe('https://getmindy.ai/opportunity-map');
    expect(u.searchParams.get('email')).toBe('pat@example.com');
    expect(u.searchParams.get('utm_campaign')).toBe('treatment_upgrade');
    expect(u.searchParams.get('utm_content')).toBe('view_dashboard');
    expect(findLegacyDestinations(`<a href="${u.toString()}">x</a>`)).toEqual([]);
  });
});

describe('call sites', () => {
  beforeEach(() => {
    sendEmail.mockClear();
    vi.resetModules();
  });

  it('feedback outreach email: "Update My Preferences" goes to preferences, never /briefings', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'test-pw');
    const { POST } = await import('@/app/api/admin/feedback/route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('https://getmindy.ai/api/admin/feedback?password=test-pw', {
      method: 'POST',
      body: JSON.stringify({ email: 'pat@example.com', action: 'send_outreach' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const { html } = sendEmail.mock.calls[0][0];
    expect(findLegacyDestinations(html)).toEqual([]);
    expect(html).toContain(`href="${feedbackOutreachPreferencesUrl('pat@example.com')}"`);
    vi.unstubAllEnvs();
  });

  it('treatment-upgrade email: "View Your Dashboard" uses the Map helper, never /briefings', () => {
    const src = readFileSync(path.resolve(__dirname, '../../app/api/admin/align-treatment-types/route.ts'), 'utf8');
    const fn = src.slice(src.indexOf('function generateUpgradeNotificationEmail('));
    expect(fn).toContain('<a href="${treatmentUpgradeDashboardUrl(email)}"');
    expect(findLegacyDestinations(fn)).toEqual([]);
  });
});
