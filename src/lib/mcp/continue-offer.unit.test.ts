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

  it('the refill carries a premium over Pro (the approved Phase 3 relationship)', () => {
    // REWRITTEN 2026-09-15 (Eric), not silently edited — the old assertion compared the
    // refill against ENTRY and would now fail. Recording why, per the precedent set when
    // Pro moved 250 -> 1,500 (tier-credits.unit.test.ts).
    //
    //   Entry  $99  / 500/mo    = 19.8c   <- the OUTLIER (see the exception test below)
    //   Refill $119 / 1,000     = 11.9c   <- one-time, ~20% premium over Pro
    //   Pro    $149 / 1,500/mo  =  9.9c   <- the best rate, as it should be
    //
    // SCOPE OF THIS ASSERTION: the approved relationship is THIS refill vs Pro — the
    // one-time pack costs more per credit than the Pro subscription. It deliberately does
    // NOT assert that Pro is permanently the cheapest offer in the catalog: a future
    // high-volume plan could beat Pro without violating anything approved here.
    const pro = PRO_MONTHLY_CREDITS;
    const topupRate = CREDIT_PACKAGES[0].usd / CREDIT_PACKAGES[0].credits;
    const proRate = 149 / pro;
    expect(topupRate).toBeGreaterThan(proRate);
    // And the premium is meaningful, not a rounding artifact.
    expect(topupRate / proRate).toBeGreaterThan(1.1);
  });

  it('OPEN: the catalog has multiple unresolved per-credit conflicts (consolidated review pending)', () => {
    // Measured 2026-09-15. Ordered cheapest per credit:
    //
    //   Pro    $149 / 1,500/mo  =  9.9c   <- best rate
    //   Refill $119 / 1,000     = 11.9c   <- one-time, the Phase 3 pack
    //   Agency $999 / 8,000/mo  = 12.5c
    //   Mid    $249 / 1,500/mo  = 16.6c
    //   Entry  $99  / 500/mo    = 19.8c
    //   Team   $499 / 1,000/mo  = 49.9c   <- 5x Pro
    //
    // FOUR subscriptions cost more per credit than a one-time pack, and Pro gives Mid's
    // exact 1,500 allowance for $100 LESS. Eric, 2026-09-15: the refill price is approved
    // and settled; these conflicts are a CONSOLIDATED PRICING REVIEW that stays open, and
    // existing subscriptions are NOT changed.
    //
    // This test documents the state rather than asserting a target, so the conflict is
    // visible in CI instead of living in a chat thread. When the review lands, replace
    // this with the invariant it decides.
    const refillRate = CREDIT_PACKAGES[0].usd / CREDIT_PACKAGES[0].credits;
    const pricier = SUBSCRIPTION_PLANS
      .filter((pl) => pl.monthly.usd / pl.creditsPerMonth > refillRate)
      .map((pl) => pl.id);
    expect(pricier.length).toBeGreaterThan(0); // known-open: not yet resolved
    // THE APPROVED RULE is narrow: THIS refill carries a premium over Pro. It is NOT
    // "Pro must always be the cheapest per credit" — a future volume plan may reasonably
    // beat it, and encoding Pro as a permanent floor would make that change look like a
    // regression (Eric, 2026-09-15).
    expect(refillRate).toBeGreaterThan(149 / PRO_MONTHLY_CREDITS);
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
