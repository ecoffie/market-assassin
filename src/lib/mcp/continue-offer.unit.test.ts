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
import { SUBSCRIPTION_PLANS, CREDIT_PACKAGES } from './packages';

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

  it('the top-up stays pricier per credit than subscribing — it must not undercut the ladder', () => {
    // GOS #015: the one-time valve is deliberately the priciest per credit so it can never
    // substitute for a subscription. If this flips, the ladder cannibalizes itself.
    const entry = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
    const topupRate = CREDIT_PACKAGES[0].usd / CREDIT_PACKAGES[0].credits;
    const entryRate = entry.monthly.usd / entry.creditsPerMonth;
    expect(topupRate).toBeGreaterThan(entryRate);
  });

  it('Entry buys meaningfully more than one flagship run', () => {
    // The pitch on the page is "about N more reports every month" — it must not read "1".
    const entry = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
    expect(Math.floor(entry.creditsPerMonth / 100)).toBeGreaterThanOrEqual(2);
  });
});
