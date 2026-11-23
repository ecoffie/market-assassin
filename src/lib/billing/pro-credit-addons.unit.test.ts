import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';
import { PRO_CREDIT_ADDONS, addonById, addonCheckoutHref, addonPrice } from './pro-credit-addons';

describe('Pro credit add-ons', () => {
  it('are exactly the existing Entry, Mid and Growth subscriptions, with their real prices and links', () => {
    expect(PRO_CREDIT_ADDONS.map((a) => a.id)).toEqual(['entry', 'mid', 'growth']);
    for (const a of PRO_CREDIT_ADDONS) {
      const p = SUBSCRIPTION_PLANS.find((s) => s.id === a.id)!;
      expect(a.credits).toBe(p.creditsPerMonth);
      expect(a.monthlyUsd).toBe(p.monthly.usd);
      expect(a.monthlyHref).toBe(p.monthly.checkoutUrl);
      expect(a.annualPerMonthUsd).toBe(p.annual!.usdPerMonth);
      expect(a.annualHref).toBe(p.annual!.checkoutUrl);
    }
  });

  it('prices follow the billing period', () => {
    const mid = addonById('mid')!;
    expect(addonPrice(mid, false)).toBe(mid.monthlyUsd);
    expect(addonPrice(mid, true)).toBe(mid.annualPerMonthUsd);
  });

  it('fills the buyer email into the checkout link only when known', () => {
    const e = addonById('entry')!;
    expect(addonCheckoutHref(e, false)).toBe(e.monthlyHref);
    expect(addonCheckoutHref(e, true, 'a+b@x.co')).toBe(`${e.annualHref}?prefilled_email=a%2Bb%40x.co`);
  });

  it('an unknown id is not an add-on', () => {
    expect(addonById('agency')).toBeNull();
    expect(addonById(null)).toBeNull();
  });
});
