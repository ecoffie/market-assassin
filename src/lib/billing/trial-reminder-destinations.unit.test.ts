/**
 * Trial-ending reminder destinations (2026-11-22). The "Open Mindy" CTA must land on the Map
 * (not legacy /app) and carry UTM tags; the cancel link must land on the Settings tab that
 * actually holds Cancel (Billing & credits), not the default Settings tab. Checked on the
 * RENDERED payload and on what sendTrialReminderEmail actually hands sendEmail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(async () => 'OK'), del: vi.fn() } }));
const sendEmail = vi.fn(async (_: { html: string; text: string }) => ({ ok: true }));
vi.mock('@/lib/send-email', () => ({ sendEmail: (p: { html: string; text: string }) => sendEmail(p) }));
import { renderTrialReminder, sendTrialReminderEmail, type TrialReminder } from './trial-reminder-email';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';

const base: TrialReminder = { email: 'a@b.com', planLabel: 'Mindy Pro', amountUsd: 149, interval: 'month', trialEnd: new Date('2026-11-26T12:00:00Z') };
const variants: Array<[string, TrialReminder]> = [
  ['no found stats', base],
  ['with found stats', { ...base, found: { alertsSent: 10, opportunitiesMatched: 143, pursuitsSaved: 2 } }],
];
const ctaHref = (html: string) => {
  const m = html.match(/<a href="([^"]+)" style="display:inline-block;padding:12px 26px/);
  if (!m) throw new Error('CTA not found');
  return new URL(m[1].replace(/&amp;/g, '&'));
};
const cancelHref = (html: string) => {
  const m = html.match(/<a href="([^"]+)"[^>]*>Settings<\/a>/);
  if (!m) throw new Error('cancel link not found');
  return new URL(m[1].replace(/&amp;/g, '&'));
};

describe('trial reminder destinations', () => {
  beforeEach(() => sendEmail.mockClear());

  it.each(variants)('%s: links to no legacy surface (html + text)', (_, r) => {
    const m = renderTrialReminder(r);
    expect(findLegacyDestinations(m.html, m.text)).toEqual([]);
  });

  it.each(variants)('%s: Open Mindy goes to the Map with UTM tags', (_, r) => {
    const u = ctaHref(renderTrialReminder(r).html);
    expect(u.origin + u.pathname).toBe('https://getmindy.ai/opportunity-map');
    expect(u.searchParams.get('utm_source')).toBe('resend');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('utm_campaign')).toBe('trial_onboarding');
    expect(u.searchParams.get('utm_content')).toBe('day11');
  });

  it('the cancel link opens Settings on the Billing tab (where Cancel lives), with UTM tags', () => {
    const u = cancelHref(renderTrialReminder(base).html);
    expect(u.pathname).toBe('/app');
    expect(u.searchParams.get('panel')).toBe('settings');
    expect(u.searchParams.get('section')).toBe('billing');
    expect(u.searchParams.get('utm_campaign')).toBe('trial_onboarding');
    expect(u.searchParams.get('utm_content')).toBe('day11_cancel');
  });

  it('call site: the payload sendTrialReminderEmail hands sendEmail is clean and tagged', async () => {
    await expect(sendTrialReminderEmail('sub_test', base)).resolves.toBe('sent');
    const p = sendEmail.mock.calls[0][0];
    expect(findLegacyDestinations(p.html, p.text)).toEqual([]);
    expect(p.html).toContain('https://getmindy.ai/opportunity-map?utm_source=resend');
    expect(p.text).toContain('Open Mindy: https://getmindy.ai/opportunity-map?utm_source=resend');
    expect(p.text).toContain('section=billing');
    expect(p.text).not.toMatch(/getmindy\.ai\/app(\s|$)/);
  });
});
