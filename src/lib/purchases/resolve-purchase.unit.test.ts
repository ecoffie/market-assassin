import { describe, it, expect } from 'vitest';
import {
  resolvePurchase, resolveCustomerPurchases, purchaseShape,
  purchaseSessionId, purchaseAmountDollars, type StripeProductCatalog,
} from './resolve-purchase';

// Mirrors the real Stripe metadata read from the live dashboard 2026-09-09.
const CATALOG: StripeProductCatalog = {
  prod_UI5RXVGKsdywuf: { tier: 'briefings', name: 'Mindy Ai' },
  prod_TmMbpcfofGpDZd: { tier: 'recompete', name: 'Recompete Contracts Tracker' },
  prod_TrI1U8j99mcAJm: { bundle: 'pro_giant', name: 'Pro Giant Bundle' },
  prod_TxGlAbj57Nlv9z: { name: 'White Glove BD Service' }, // known to Stripe, NO tier
};

describe('shape detection', () => {
  it('mindy shape when stripe_session_id present', () => {
    expect(purchaseShape({ stripe_session_id: 'cs_live_x' })).toBe('mindy');
  });
  it('shop shape when only order_id present', () => {
    expect(purchaseShape({ order_id: 'cs_live_y' })).toBe('shop');
  });
  it('unknown when neither — never coerced into a shape', () => {
    expect(purchaseShape({ product_id: 'x' })).toBe('unknown');
  });
});

describe('session id mirrors the uniq_purchases_session_any COALESCE', () => {
  it('prefers stripe_session_id', () => {
    expect(purchaseSessionId({ stripe_session_id: 'cs_a', order_id: 'cs_b' })).toBe('cs_a');
  });
  it('falls back to order_id', () => {
    expect(purchaseSessionId({ order_id: 'cs_b' })).toBe('cs_b');
  });
  it('empty string is not an id', () => {
    expect(purchaseSessionId({ stripe_session_id: '', order_id: '' })).toBeNull();
  });
});

describe('amount scaling — the 100x trap', () => {
  it('mindy amounts are already dollars', () => {
    expect(purchaseAmountDollars({ stripe_session_id: 'cs_a', amount_paid: 149 })).toBe(149);
  });
  it('shop amounts are cents', () => {
    expect(purchaseAmountDollars({ order_id: 'cs_b', amount_paid: 14900 })).toBe(149);
  });
  it('unknown shape refuses to pick a scale', () => {
    expect(purchaseAmountDollars({ amount_paid: 14900 })).toBeNull();
  });
  it('null amount stays null, never 0', () => {
    expect(purchaseAmountDollars({ order_id: 'cs_b', amount_paid: null })).toBeNull();
  });
});

describe('E1 explicit tier', () => {
  it('resolves from the row itself', () => {
    const r = resolvePurchase({ stripe_session_id: 'cs_a', tier: 'briefings', amount_paid: 149 });
    expect(r).toMatchObject({ resolved: true, tier: 'briefings', evidence: 'explicit_tier' });
  });
  it('backfill_unknown is NOT evidence', () => {
    const r = resolvePurchase({ stripe_session_id: 'cs_a', tier: 'backfill_unknown' });
    expect(r.resolved).toBe(false);
    expect(r.tier).toBeNull();
  });
  it('literal "unknown" is NOT evidence', () => {
    expect(resolvePurchase({ stripe_session_id: 'cs_a', tier: 'unknown' }).resolved).toBe(false);
  });
});

describe('E2 catalog product id', () => {
  it('resolves a canonical tool id', () => {
    const r = resolvePurchase({ order_id: 'cs_b', product_id: 'opportunity-hunter-pro', amount_paid: 4900 });
    expect(r).toMatchObject({ resolved: true, tier: 'hunter_pro', evidence: 'catalog_product' });
  });
  it('a bundle resolves to a bundle, not a single tier', () => {
    const r = resolvePurchase({ order_id: 'cs_b', product_id: 'ultimate-govcon-bundle', amount_paid: 149700 });
    expect(r).toMatchObject({ resolved: true, bundle: 'ultimate', tier: null });
  });
  it('resolves regardless of amount — repricing does not break it', () => {
    for (const amt of [100000, 149700, 50000]) {
      expect(resolvePurchase({ order_id: 'cs_b', product_id: 'ultimate-govcon-bundle', amount_paid: amt }).bundle)
        .toBe('ultimate');
    }
  });
});

describe('E3 Stripe product metadata', () => {
  it('resolves the shared prod_ id via Stripe metadata', () => {
    const r = resolvePurchase(
      { order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf', product_name: 'Mindy Ai', amount_paid: 14900 },
      CATALOG);
    expect(r).toMatchObject({ resolved: true, tier: 'briefings', evidence: 'stripe_metadata' });
  });
  it('resolves the SAME id at a different amount — amount is not the key', () => {
    for (const amt of [4900, 14900, 49700, 49900, 149000, 299700]) {
      const r = resolvePurchase(
        { order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf', amount_paid: amt }, CATALOG);
      expect(r.tier).toBe('briefings');
    }
  });
  it('notes a product_name conflict but still resolves on metadata', () => {
    const r = resolvePurchase(
      { order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf', product_name: 'Market Intelligence', amount_paid: 14900 },
      CATALOG);
    expect(r.resolved).toBe(true);
    expect(r.notes.join(' ')).toMatch(/differs from Stripe/);
  });
  it('Stripe knows the product but has no tier → UNRESOLVED, needs a human', () => {
    const r = resolvePurchase(
      { order_id: 'cs_b', product_id: 'prod_TxGlAbj57Nlv9z', amount_paid: 600000 }, CATALOG);
    expect(r.resolved).toBe(false);
    expect(r.requiresHumanClassification).toBe(true);
    expect(r.unresolvedReason).toMatch(/no tier or bundle metadata/);
  });
  it('without a catalog, prod_ rows stay unresolved rather than guessed', () => {
    const r = resolvePurchase({ order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf', amount_paid: 14900 });
    expect(r.resolved).toBe(false);
  });
});

describe('THE LOAD-BEARING RULE: unresolved is never free', () => {
  it('an unresolved row reports tier null and resolved false — not a free tier', () => {
    const r = resolvePurchase({ order_id: 'cs_b', product_id: 'prod_NOPE', amount_paid: 99700 });
    expect(r.resolved).toBe(false);
    expect(r.tier).toBeNull();
    expect(r.bundle).toBeNull();
    // The critical assertion: nothing in the output can be read as "free" or "none".
    expect(JSON.stringify(r)).not.toMatch(/"tier":"free"/);
    expect(r.requiresHumanClassification).toBe(true);
    expect(r.unresolvedReason).toBeTruthy();
  });
  it('a paying customer with an unresolved row surfaces hasUnresolved, not silence', () => {
    const out = resolveCustomerPurchases(
      [{ order_id: 'cs_b', product_id: 'prod_NOPE', amount_paid: 99700 }], CATALOG);
    expect(out.hasUnresolved).toBe(true);
    expect(out.tiers).toEqual([]);
    expect(out.unresolved).toHaveLength(1);
  });
});

describe('notes surface conditions rather than hiding them', () => {
  it('flags a superseded row', () => {
    const r = resolvePurchase({ stripe_session_id: 'cs_a', tier: 'briefings', superseded_by: 'abc' });
    expect(r.notes.join(' ')).toMatch(/superseded/);
  });
  it('flags a charge id masquerading as a session id', () => {
    const r = resolvePurchase({ order_id: 'ch_3Tigo', product_id: 'mindy-teams-annual', amount_paid: 600000 });
    expect(r.notes.join(' ')).toMatch(/not a checkout session/);
  });
});

describe('customer rollup', () => {
  it('excludes superseded duplicates', () => {
    const out = resolveCustomerPurchases([
      { stripe_session_id: 'cs_a', tier: 'briefings' },
      { stripe_session_id: 'cs_a', tier: 'briefings', superseded_by: 'x' },
    ], CATALOG);
    expect(out.resolved).toHaveLength(1);
  });
  it('dedupes tiers across rows', () => {
    const out = resolveCustomerPurchases([
      { stripe_session_id: 'cs_a', tier: 'briefings' },
      { order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf' },
    ], CATALOG);
    expect(out.tiers).toEqual(['briefings']);
  });
});

describe('E4 Stripe price id → product → metadata', () => {
  const PRICES = {
    price_1TTYe9K5zyiZ50PBmJlUQuXQ: 'prod_UI5RXVGKsdywuf',   // real: Mindy Ai $149/mo
    price_1TuyGyK5zyiZ50PBUfIkFbvD: 'prod_UumkGov5iWq6yV',   // real: MCP Entry, no tier
  };
  const CAT: StripeProductCatalog = {
    ...CATALOG,
    prod_UumkGov5iWq6yV: { name: 'Mindy MCP — Entry' }, // no tier metadata
  };

  it('resolves a price id to the same tier as the product id', () => {
    const viaPrice = resolvePurchase(
      { stripe_session_id: 'cs_a', product_id: 'price_1TTYe9K5zyiZ50PBmJlUQuXQ', amount_paid: 149 },
      CAT, PRICES);
    const viaProd = resolvePurchase(
      { order_id: 'cs_b', product_id: 'prod_UI5RXVGKsdywuf', amount_paid: 14900 }, CAT, PRICES);
    expect(viaPrice.tier).toBe('briefings');
    // The point of E4: the SAME purchase resolves identically regardless of which id
    // the handler happened to store.
    expect(viaPrice.tier).toBe(viaProd.tier);
    expect(viaPrice.evidence).toBe('stripe_price_product');
  });

  it('a price whose product has no tier stays UNRESOLVED', () => {
    const r = resolvePurchase(
      { stripe_session_id: 'cs_a', product_id: 'price_1TuyGyK5zyiZ50PBUfIkFbvD', amount_paid: 990 },
      CAT, PRICES);
    expect(r.resolved).toBe(false);
    expect(r.requiresHumanClassification).toBe(true);
    expect(r.unresolvedReason).toMatch(/no tier or bundle metadata/);
  });

  it('without a price index, a price id stays unresolved rather than guessed', () => {
    const r = resolvePurchase(
      { stripe_session_id: 'cs_a', product_id: 'price_1TTYe9K5zyiZ50PBmJlUQuXQ', amount_paid: 149 }, CAT);
    expect(r.resolved).toBe(false);
  });
});
