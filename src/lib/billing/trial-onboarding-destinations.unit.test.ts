/**
 * Trial onboarding CTAs (2026-11-21): every step must land on a current (Map-era) surface,
 * never legacy /app, and carry UTM tags so the sequence's effect on activation is measurable.
 * Checked on the RENDERED payload and on what sendTrialStepEmail actually hands sendEmail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(async () => 'OK'), del: vi.fn() } }));
const sendEmail = vi.fn(async (_: { html: string; text: string }) => ({ ok: true }));
vi.mock('@/lib/send-email', () => ({ sendEmail: (p: { html: string; text: string }) => sendEmail(p) }));
import { renderTrialStep, sendTrialStepEmail, type TrialStep } from './trial-onboarding-emails';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';

const ctx = { email: 'a@b.com', firstName: 'Maria', planLabel: 'Mindy Pro', amountUsd: 149, interval: 'month' as const, trialEnd: new Date('2026-11-26T12:00:00Z') };
const STEPS: TrialStep[] = ['day0', 'day1', 'day3', 'day7'];
const ctaHref = (html: string) => {
  const m = html.match(/<a href="([^"]+)" style="display:inline-block;padding:12px 26px/);
  if (!m) throw new Error('CTA not found');
  return new URL(m[1].replace(/&amp;/g, '&'));
};

describe('trial onboarding CTA destinations', () => {
  beforeEach(() => { delete process.env.MINDY_SETUP_CALL_URL; sendEmail.mockClear(); });

  it.each(STEPS)('%s links to no legacy surface (html + text)', (step) => {
    const m = renderTrialStep(step, ctx);
    expect(findLegacyDestinations(m.html, m.text)).toEqual([]);
  });

  it('each step goes to the Map-era page that matches its copy', () => {
    expect(ctaHref(renderTrialStep('day0', ctx).html).pathname).toBe('/alerts/preferences');
    expect(ctaHref(renderTrialStep('day1', ctx).html).pathname).toBe('/alerts/preferences');
    const d3 = ctaHref(renderTrialStep('day3', ctx).html);
    expect(d3.pathname).toBe('/opportunity-map');
    expect(d3.searchParams.get('horizon')).toBe('recompete');
    expect(ctaHref(renderTrialStep('day7', ctx).html).pathname).toBe('/opportunity-map/pursuits');
  });

  it.each(STEPS)('%s CTA carries UTM tags naming the step', (step) => {
    const u = ctaHref(renderTrialStep(step, ctx).html);
    expect(u.searchParams.get('utm_source')).toBe('resend');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('utm_campaign')).toBe('trial_onboarding');
    expect(u.searchParams.get('utm_content')).toBe(step);
  });

  it('day 1 keeps the booking link itself unchanged (third-party URL, no UTM added)', () => {
    process.env.MINDY_SETUP_CALL_URL = 'https://cal.example/mindy';
    const u = ctaHref(renderTrialStep('day1', ctx).html);
    expect(u.toString()).toBe('https://cal.example/mindy');
  });

  it('call site: the payload sendTrialStepEmail hands sendEmail is clean and tagged', async () => {
    for (const step of STEPS) {
      sendEmail.mockClear();
      await expect(sendTrialStepEmail('sub_test', step, ctx)).resolves.toBe('sent');
      const p = sendEmail.mock.calls[0][0];
      expect(findLegacyDestinations(p.html, p.text)).toEqual([]);
      expect(p.html).toContain(`utm_content=${step}`);
      expect(p.text).toContain(`utm_content=${step}`);
    }
  });
});
