import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dailyAlertViewAllCta, canonicalNaics } from './daily-alert-view-all';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';
import { ctaContractViolations, type PopulationScope } from './population-contract';

/**
 * Prod 2026-11-22: '[email-migration] 1 legacy destination(s) in "daily_alert": /app (inside
 * /api/track) -> https://getmindy.ai/app?panel=alerts...' — 305 times in 12h. Every daily alert
 * with more matches than rows linked "View all N matching contracts" to retired /app.
 */
const SITE = 'https://getmindy.ai';
const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/cron/daily-alerts/route.ts'), 'utf8');

const tracked = (url: string) =>
  `<a href="${SITE}/api/track?t=x&url=${encodeURIComponent(url)}">x</a>`;

describe('dailyAlertViewAllCta', () => {
  it('lands on the Map Open horizon scoped to the alert NAICS — never legacy /app', () => {
    const cta = dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: ['541512', '541519'], moreCount: 12 });
    expect(cta.href).toBe(`${SITE}/opportunity-map?naics=541512,541519&horizon=open`);
    expect(findLegacyDestinations(tracked(cta.href))).toEqual([]);
  });

  it('never carries the reader state (the ?naics=&state= 5,416 -> 0 incident)', () => {
    const cta = dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: ['236220'], moreCount: 3 });
    expect(cta.href).not.toMatch(/[?&]state=/);
  });

  it('falls back to the unscoped Open map when the profile has no usable NAICS', () => {
    const cta = dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: ['', 'abc', null], moreCount: 4 });
    expect(cta.href).toBe(`${SITE}/opportunity-map?horizon=open`);
    expect(cta.label).toBe('See open contracts on the Map');
  });

  it('names two populations: the email remainder, and what the Map shows', () => {
    const cta = dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: ['541512'], moreCount: 12 });
    expect(cta.remainder).toBe("12 more matches aren't shown here.");
    expect(cta.label).toBe('See open contracts in your NAICS codes on the Map');
    expect(dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: [], moreCount: 1 }).remainder)
      .toBe("1 more match isn't shown here.");
  });

  it('the link text makes no count or newness claim the destination cannot honour', () => {
    const cta = dailyAlertViewAllCta({ siteUrl: SITE, naicsCodes: ['541512'], moreCount: 12 });
    expect(cta.label).not.toMatch(/\d|\ball\b|\bnew\b/i);
    const mapOpen: PopulationScope = { sources: ['contracts'], window: null, filters: ['naics'] };
    expect(ctaContractViolations({ count: 0, label: cta.label, scope: mapOpen }, mapOpen, { usingFallback: true })).toEqual([]);
  });

  it('canonicalNaics keeps 2-6 digit codes, deduped', () => {
    expect(canonicalNaics([' 541512', '541512', '54', '1234567', 'x'])).toEqual(['541512', '54']);
  });
});

describe('daily-alerts route wiring', () => {
  it('no longer links to /app?panel=alerts', () => {
    expect(ROUTE).not.toMatch(/\/app\?panel=alerts/);
  });

  it('builds the view-all CTA from the helper with the alert NAICS', () => {
    expect(ROUTE).toMatch(/dailyAlertViewAllCta\(\{\s*siteUrl: MINDY_SITE_URL,\s*naicsCodes: user\.naics_codes,\s*moreCount,?\s*\}\)/);
    expect(ROUTE).toMatch(/trackedUrl\(viewAllCta\.href, 'view_all_new', 'view_all_new'\)/);
    expect(ROUTE).toContain('${viewAllCta.remainder}');
    expect(ROUTE).toContain('${viewAllCta.label}');
  });
});
