/**
 * The /mcp/continue affordability contract.
 *
 * THE BUG (measured 2026-08-22 → 08-28): the resume page showed ONE "Run it" button to
 * everyone, including the zero-balance users the paywall had just sent there. Pressing it
 * returned "Your upgrade has not landed yet" — for an upgrade they had never started — and
 * the only way to buy was a small link underneath. 40 paywall attempts from 15 users
 * produced 1 page view and 0 purchases. The demand was real; the page did not sell to it.
 *
 * These tests pin the decision the page makes, and the two rules that keep it honest:
 *   - unknown balance is NOT zero (never assert a number we could not read)
 *   - prices come from packages.ts, never hardcoded in the page
 */
import { describe, it, expect } from 'vitest';
import { SUBSCRIPTION_PLANS, CREDIT_PACKAGES, PRO_MONTHLY_CREDITS } from './packages';

/** Mirrors the page: affordable only when the balance is KNOWN and sufficient. */
function canAfford(balance: number | null, cost: number): boolean {
  return balance != null && balance >= cost;
}

describe('affordability gate', () => {
  it('a zero-balance user is shown the offer, not a Run button', () => {
    expect(canAfford(0, 100)).toBe(false);
  });

  it('a partially funded user is still shown the offer', () => {
    // The exact shape that produced "upgrade has not landed yet": 10 credits, 100 needed.
    expect(canAfford(10, 100)).toBe(false);
  });

  it('a funded user goes straight to Run — no upsell in the way', () => {
    expect(canAfford(260, 100)).toBe(true);
  });

  it('an exact balance can run', () => {
    expect(canAfford(100, 100)).toBe(true);
  });

  it('an UNKNOWN balance shows the offer rather than claiming they can run', () => {
    // getBalance failed. Unknown is not zero and not "affordable" — show options,
    // assert nothing. (Bug Prevention Rule #11 applied to a UI decision.)
    expect(canAfford(null, 100)).toBe(false);
  });

  it('a free tool (cost 0) is runnable when the balance is known', () => {
    expect(canAfford(0, 0)).toBe(true);
  });
});

describe('the offer is wired to the real ladder', () => {
  it('the Entry plan exists and carries a live checkout URL', () => {
    const entry = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
    expect(entry).toBeDefined();
    expect(entry.monthly.usd).toBeGreaterThan(0);
    expect(entry.creditsPerMonth).toBeGreaterThan(0);
    expect(entry.monthly.checkoutUrl).toMatch(/^https:\/\/buy\.stripe\.com\//);
  });

  it('a one-time top-up exists for users who refuse subscriptions', () => {
    const topup = CREDIT_PACKAGES[0];
    expect(topup).toBeDefined();
    expect(topup.credits).toBeGreaterThan(0);
    expect(topup.usd).toBeGreaterThan(0);
    expect(topup.checkoutUrl).toMatch(/^https:\/\/buy\.stripe\.com\//);
  });

  it('the refill stays pricier per credit than PRO — the subscription must remain the best rate', () => {
    // REWRITTEN 2026-09-15 (Eric), not silently edited — the old assertion compared the
    // refill against ENTRY and would now fail. Recording why, per the precedent set when
    // Pro moved 250 -> 1,500 (tier-credits.unit.test.ts).
    //
    //   Entry  $99  / 500/mo    = 19.8c   <- the OUTLIER (see the exception test below)
    //   Refill $119 / 1,000     = 11.9c   <- one-time, ~20% premium over Pro
    //   Pro    $149 / 1,500/mo  =  9.9c   <- the best rate, as it should be
    //
    // The invariant is the refill-vs-PRO relationship: a one-time pack must never be the
    // cheapest credit in the catalog, or the recurring plan cannibalizes itself. It is
    // NOT "top-ups beat subscriptions" generally — the refill does not beat Pro.
    const pro = PRO_MONTHLY_CREDITS;
    const topupRate = CREDIT_PACKAGES[0].usd / CREDIT_PACKAGES[0].credits;
    const proRate = 149 / pro;
    expect(topupRate).toBeGreaterThan(proRate);
    // And the premium is meaningful, not a rounding artifact.
    expect(topupRate / proRate).toBeGreaterThan(1.1);
  });

  it('KNOWN EXCEPTION: Entry is priced above the refill per credit', () => {
    // Deliberately asserted so the anomaly is visible rather than forgotten. Entry
    // ($99/500 = 19.8c) is the oldest offer in the ladder and is now the most expensive
    // credit we sell — above both the refill and Pro. Eric, 2026-09-15: existing Entry
    // subscriptions are UNCHANGED; whether Entry should stay available to NEW buyers is a
    // separate pricing decision, not settled here. When it is, update this test with it.
    const entry = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
    const entryRate = entry.monthly.usd / entry.creditsPerMonth;
    const topupRate = CREDIT_PACKAGES[0].usd / CREDIT_PACKAGES[0].credits;
    expect(entryRate).toBeGreaterThan(topupRate);
  });

  it('Entry buys meaningfully more than one flagship run', () => {
    // The pitch on the page is "about N more reports every month" — it must not read "1".
    const entry = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
    expect(Math.floor(entry.creditsPerMonth / 100)).toBeGreaterThanOrEqual(2);
  });
});
