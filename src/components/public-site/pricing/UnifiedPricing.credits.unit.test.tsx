/**
 * /mcp/pricing credit allocations (Eric, 2026-11-13): Entry $99/500 · Mid $249/3,000 ·
 * Growth $399/5,000 monthly; annual = 12x upfront (6,000 / 36,000 / 60,000) at the
 * unchanged annual prices.
 *
 * The page must never promise more than the webhook grants. The grant is resolved by
 * Stripe price id from SUBSCRIPTION_PLANS (packages.ts); the page renders the live
 * /api/mcp/catalog (same constant) or, before it loads, PLANS_FALLBACK. Both are pinned
 * here, and the fallback is checked field-for-field against the grant table so they
 * cannot drift apart again.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import UnifiedPricing, { PLANS_FALLBACK } from './UnifiedPricing';
import { SUBSCRIPTION_PLANS, subscriptionGrantForPriceId } from '@/lib/mcp/packages';

const APPROVED = {
  entry:  { usd: 99,  monthly: 500,  annualUsd: 990,  annual: 6000 },
  mid:    { usd: 249, monthly: 3000, annualUsd: 2490, annual: 36000 },
  growth: { usd: 399, monthly: 5000, annualUsd: 3990, annual: 60000 },
} as const;

describe('MCP plan grants (what the webhook actually issues)', () => {
  for (const [id, a] of Object.entries(APPROVED)) {
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === id)!;
    it(`${id}: monthly price grants ${a.monthly}, annual price grants ${a.annual}; prices unchanged`, () => {
      expect(plan.creditsPerMonth).toBe(a.monthly);
      expect(plan.monthly.usd).toBe(a.usd);
      expect(plan.annual!.usd).toBe(a.annualUsd);
      expect(plan.annual!.credits).toBe(plan.creditsPerMonth * 12);
      expect(subscriptionGrantForPriceId(plan.monthly.priceId)).toEqual({ planId: id, credits: a.monthly, interval: 'month' });
      expect(subscriptionGrantForPriceId(plan.annual!.priceId)).toEqual({ planId: id, credits: a.annual, interval: 'year' });
    });
  }
});

describe('/mcp/pricing static fallback matches the grant table', () => {
  it('every fallback plan is field-for-field identical to SUBSCRIPTION_PLANS', () => {
    for (const f of PLANS_FALLBACK) {
      const s = SUBSCRIPTION_PLANS.find((p) => p.id === f.id);
      expect(s, f.id).toBeDefined();
      expect({ c: f.creditsPerMonth, m: f.monthly, a: f.annual }).toEqual({ c: s!.creditsPerMonth, m: s!.monthly, a: s!.annual });
    }
  });
});

describe('/mcp/pricing renders the approved allocations', () => {
  const html = renderToStaticMarkup(
    <UnifiedPricing initialTab="mcp" proCredits={1500} teamCredits={7000} signupCredits={100} forecastsLabel="33,000+" faqs={[]} />,
  );
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const text = doc.body.textContent ?? '';

  it('cards show 500 / 3,000 / 5,000 credits per month and no retired figure', () => {
    const cardCredits = [...doc.querySelectorAll('.credits .main b')].map((b) => b.textContent);
    for (const n of ['500 credits', '3,000 credits', '5,000 credits']) expect(cardCredits).toContain(n);
    expect(cardCredits).not.toContain('2,000 credits');
    expect(cardCredits).not.toContain('3,500 credits');
  });

  it('comparison table monthly allowance row uses the new numbers', () => {
    expect(text).toContain('3,000/mo');
    expect(text).toContain('5,000/mo');
    expect(text).not.toContain('2,000/mo');
    expect(text).not.toContain('3,500/mo');
  });
});
