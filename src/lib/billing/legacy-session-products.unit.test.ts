import { describe, it, expect } from 'vitest';
import { LEGACY_PRICE_PRODUCTS, productsFromLineItems, isLegacySessionProduct } from './legacy-session-products';

describe('legacy price map', () => {
  it('maps each of the 7 products exactly once', () => {
    const vals = Object.values(LEGACY_PRICE_PRODUCTS);
    expect(new Set(vals).size).toBe(7);
    expect(vals.length).toBe(7);
  });
  it('derives products from line items, ignoring unknown prices and zero quantity', () => {
    const [a, b] = Object.keys(LEGACY_PRICE_PRODUCTS);
    expect(productsFromLineItems([{ price: { id: 'price_x' } }, { price: { id: a } }, { price: a }, { price: { id: b }, quantity: 0 }]))
      .toEqual([LEGACY_PRICE_PRODUCTS[a]]);
    expect(productsFromLineItems(undefined)).toEqual([]);
  });
  it('recognises only listed product names', () => {
    expect(isLegacySessionProduct('full-fix')).toBe(true);
    expect(isLegacySessionProduct('briefings')).toBe(false);
  });
});
