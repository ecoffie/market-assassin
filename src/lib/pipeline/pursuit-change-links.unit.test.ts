import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PURSUITS_PAGE_URL,
  PURSUIT_CHANGES_EMAIL_CTA_URL,
  PURSUIT_CHANGES_SMS_LINK,
} from './pursuit-change-links';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';

const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/cron/pursuit-changes/route.ts'), 'utf8');

describe('pursuit-changes alert destinations', () => {
  it('email CTA goes to the Map Pursuits page with UTM tags', () => {
    const u = new URL(PURSUIT_CHANGES_EMAIL_CTA_URL);
    expect(`${u.origin}${u.pathname}`).toBe(PURSUITS_PAGE_URL);
    expect(u.searchParams.get('utm_source')).toBe('resend');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('utm_campaign')).toBe('pursuit_changes');
    expect(u.searchParams.get('utm_content')).toBe('open_my_pursuits');
  });

  it('SMS link is the Pursuits page, not legacy /app', () => {
    expect(PURSUIT_CHANGES_SMS_LINK).toBe('getmindy.ai/opportunity-map/pursuits');
  });

  it('the legacy-destination guard passes the rendered CTA', () => {
    const html = `<a href="${PURSUIT_CHANGES_EMAIL_CTA_URL}">Open My Pursuits →</a>`;
    expect(findLegacyDestinations(html)).toEqual([]);
  });

  describe('call site (route.ts)', () => {
    it('wires the email CTA and SMS link from the helper', () => {
      expect(ROUTE).toMatch(/<a href="\$\{PURSUIT_CHANGES_EMAIL_CTA_URL\}"[^>]*>Open My Pursuits →<\/a>/);
      expect(ROUTE).toContain('${more}. ${PURSUIT_CHANGES_SMS_LINK}`');
    });

    it('no longer links to the legacy /app anywhere', () => {
      expect(ROUTE).not.toMatch(/getmindy\.ai\/app\b/);
    });
  });
});
