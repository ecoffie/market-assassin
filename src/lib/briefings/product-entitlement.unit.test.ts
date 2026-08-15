import { describe, it, expect } from 'vitest';
import { briefingGrantForPurchase, briefingGrantForCustomer } from './product-entitlement';

/**
 * Cases are drawn from the REAL catalog audit (2026-08-15) — every product
 * string here is one customers actually bought.
 */
describe('briefingGrantForPurchase — the rule set 2026-08-15', () => {
  it('grants on Mindy Ai at $149 (the #1 product, which had NO rule before)', () => {
    const g = briefingGrantForPurchase('Mindy Ai', 14900);
    expect(g.earns).toBe(true);
    if (g.earns) expect(g.access).toBe('subscription');
  });

  it('grants LIFETIME on Mindy Teams — no subscription exists to be active', () => {
    const g = briefingGrantForPurchase('Mindy Teams — Annual (Lisa Marshall team)', 600000);
    expect(g.earns).toBe(true);
    if (g.earns) {
      expect(g.access).toBe('lifetime');
      // The $6,000 Teams owner was stranded twice by rules that demanded an
      // active sub she never had.
      expect(g.requiresActiveSub).toBe(false);
    }
  });

  it('does NOT grant on Mindy MCP — it sells API credits, not briefings', () => {
    expect(briefingGrantForPurchase('Mindy MCP — Entry', 99000).earns).toBe(false);
    expect(briefingGrantForPurchase('Mindy MCP Credits — Starter', 500).earns).toBe(false);
  });

  it('does NOT grant under $99, even for a Mindy product', () => {
    expect(briefingGrantForPurchase('Mindy Ai', 1490).earns).toBe(false);   // trial
    expect(briefingGrantForPurchase('Mindy Ai', 2997).earns).toBe(false);   // partial
    expect(briefingGrantForPurchase('Mindy Ai', 149).earns).toBe(false);    // $1.49 test
    expect(briefingGrantForPurchase('Market Intelligence', 4900).earns).toBe(false);
  });

  it('does NOT grant on legacy bundles or non-Mindy products', () => {
    expect(briefingGrantForPurchase('Ultimate GovCon Bundle', 100000).earns).toBe(false);
    expect(briefingGrantForPurchase('Opportunity Hunter Pro', 4900).earns).toBe(false);
    expect(briefingGrantForPurchase('Federal Contractor Database', 49700).earns).toBe(false);
    expect(briefingGrantForPurchase('Recompete Contracts Tracker', 39700).earns).toBe(false);
  });

  it('grants at exactly $99 (boundary is inclusive)', () => {
    expect(briefingGrantForPurchase('Mindy Ai', 9900).earns).toBe(true);
    expect(briefingGrantForPurchase('Mindy Ai', 9899).earns).toBe(false);
  });

  it('handles a missing product name without throwing', () => {
    expect(briefingGrantForPurchase(null, 100000).earns).toBe(false);
    expect(briefingGrantForPurchase('', 100000).earns).toBe(false);
  });
});

describe('briefingGrantForCustomer', () => {
  it('prefers lifetime over subscription when both were bought', () => {
    const g = briefingGrantForCustomer([
      { product_name: 'Mindy Ai', amount_paid: 14900 },
      { product_name: 'Mindy Teams — Annual', amount_paid: 600000 },
    ]);
    expect(g.earns).toBe(true);
    if (g.earns) expect(g.access).toBe('lifetime');
  });

  it('does not let many small charges add up past the $99 floor', () => {
    const g = briefingGrantForCustomer([
      { product_name: 'Mindy Ai', amount_paid: 1490 },
      { product_name: 'Mindy Ai', amount_paid: 2997 },
      { product_name: 'Mindy Ai', amount_paid: 4990 },
    ]);
    expect(g.earns).toBe(false);
  });

  it('ignores MCP even alongside qualifying spend below the floor', () => {
    const g = briefingGrantForCustomer([
      { product_name: 'Mindy MCP — Entry', amount_paid: 99000 },
      { product_name: 'Mindy Ai', amount_paid: 1490 },
    ]);
    expect(g.earns).toBe(false);
  });
});
