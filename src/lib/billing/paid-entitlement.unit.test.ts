import { describe, it, expect } from 'vitest';
import { isEntitling, tierFor, findMismatches, type StripeSub } from './paid-entitlement';

/**
 * This rule decides who gets PAID access. Two ways to be wrong, and both are
 * real defects that happened:
 *   - too narrow → a paying customer keeps the free tier (49 of them, 2026-08-19)
 *   - too broad  → a course buyer is granted Mindy (the naive "any active
 *                  subscription" rule would have granted 68, most non-Mindy)
 * So the tests pin BOTH directions, using the actual product names from the
 * live Stripe catalog rather than invented ones.
 */

const sub = (productName: string, amount: number, interval: 'month' | 'year' = 'month'): StripeSub =>
  ({ email: 'x@y.com', productName, amount, interval });

describe('isEntitling — named products', () => {
  it('entitles the Mindy SKUs at every price', () => {
    expect(isEntitling(sub('Mindy Ai', 1490, 'year'))).toBe(true);
    expect(isEntitling(sub('Mindy Ai', 49))).toBe(true);          // below the $99 floor
    expect(isEntitling(sub('Mindy MCP — Entry', 990, 'year'))).toBe(true);
  });

  it('entitles the honored GovCon Giants plans', () => {
    expect(isEntitling(sub('Pro Member Plan - Monthly', 99))).toBe(true);
    expect(isEntitling(sub('Ongoing Coaching - Monthly', 99))).toBe(true);
    expect(isEntitling(sub('PRO Member Lifetime Plan 1 - 12 Monthly Installments', 497))).toBe(true);
    expect(isEntitling(sub('Small Business', 997, 'year'))).toBe(true);
    expect(isEntitling(sub('Alert Pro', 19))).toBe(true);          // named, below the floor
  });

  it('entitles "Copy of PRO Member Group" — a duplicated Pro SKU, ~19 real subscribers', () => {
    expect(isEntitling(sub('Copy of PRO Member Group - Monthly', 99))).toBe(true);
  });
});

describe('isEntitling — the honored monthly floor', () => {
  it('entitles ANY monthly at or above $99, whatever the product', () => {
    // Eric: "we did honor any monthly subscriptions over $99/mo" — applied
    // literally, so Academy at $799/mo qualifies on price despite being a course.
    expect(isEntitling(sub('Academy 3.0 6 Month', 799))).toBe(true);
    expect(isEntitling(sub('Some Future Plan', 99))).toBe(true);
  });

  it('does NOT entitle non-Mindy products below the floor', () => {
    expect(isEntitling(sub('Starter Plan (in) - Monthly', 27))).toBe(false);
    expect(isEntitling(sub('FHC Community Plan - Monthly', 9))).toBe(false);
  });

  it('does NOT let the floor leak to ANNUAL plans', () => {
    // The floor is a MONTHLY promise. A $497/yr Rhinos plan is ~$41/mo and was
    // never honored; treating it as ">= 99" because the number is large would
    // grant Mindy to a different product's customers.
    expect(isEntitling(sub('Rhinos Bid Alert', 497, 'year'))).toBe(false);
    expect(isEntitling(sub('ACADEMY 3.0 Yearly', 1500, 'year'))).toBe(false);
    expect(isEntitling(sub('ACADEMY 3.0 (all courses for one low price)', 5, 'year'))).toBe(false);
  });
});

describe('tierFor', () => {
  it('maps annual to 1_year and monthly to subscription', () => {
    expect(tierFor({ interval: 'year' })).toBe('1_year');
    expect(tierFor({ interval: 'month' })).toBe('subscription');
  });
});

describe('findMismatches', () => {
  it('flags a paying customer on the free tier', () => {
    const m = findMismatches(
      [{ ...sub('Mindy Ai', 1490, 'year'), email: 'a@b.com' }],
      new Map([['a@b.com', 'beta_preview']]),
    );
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ currentAccess: 'beta_preview', targetAccess: '1_year' });
  });

  it('flags a paying customer with NO classification row', () => {
    const m = findMismatches([{ ...sub('Mindy MCP — Entry', 990, 'year'), email: 'c@d.com' }], new Map());
    expect(m[0].currentAccess).toBeNull();
  });

  it('leaves an already-correct customer alone', () => {
    const m = findMismatches(
      [{ ...sub('Mindy Ai', 149), email: 'e@f.com' }],
      new Map([['e@f.com', 'subscription']]),
    );
    expect(m).toHaveLength(0);
  });

  it('never flags a non-entitling product', () => {
    const m = findMismatches(
      [{ ...sub('Starter Plan (in) - Monthly', 27), email: 'g@h.com' }],
      new Map([['g@h.com', 'beta_preview']]),
    );
    expect(m).toHaveLength(0);
  });

  it('picks the HIGHEST-priced subscription when one email holds several', () => {
    // A customer on both Starter ($27) and Mindy Ai ($149) is a Mindy customer.
    // Letting the cheaper row decide would under-grant.
    const m = findMismatches(
      [
        { ...sub('Starter Plan (in) - Monthly', 27), email: 'i@j.com' },
        { ...sub('Mindy Ai', 149), email: 'i@j.com' },
      ],
      new Map([['i@j.com', 'beta_preview']]),
    );
    expect(m).toHaveLength(1);
    expect(m[0].productName).toBe('Mindy Ai');
  });

  it('normalizes email case so a capitalized Stripe email still matches', () => {
    const m = findMismatches(
      [{ ...sub('Mindy Ai', 149), email: 'Mixed@Case.COM' }],
      new Map([['mixed@case.com', 'subscription']]),
    );
    expect(m).toHaveLength(0);
  });
});
