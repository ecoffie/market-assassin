import { describe, it, expect } from 'vitest';
import { smallBizSharePct } from './share';

describe('smallBizSharePct — small-business share can never exceed 100%', () => {
  it('uses satBase (matching row set) as the denominator when present', () => {
    // The real Appalachian Wood Products case: satTotal summed over per-agency
    // rows (~$2.0B) with a matching base of ~$2.9B → ~69%, NOT 13935%.
    expect(smallBizSharePct({ satTotal: 2.0e9, satBase: 2.9e9, totalSpending: 14.5e6 }))
      .toBeCloseTo(69.0, 0);
  });

  it('never returns the >100% blowup even if only totalSpending is available', () => {
    // Mismatched scope (numerator billions / denominator millions) → clamped to 100.
    expect(smallBizSharePct({ satTotal: 2.0e9, totalSpending: 14.5e6 })).toBe(100);
  });

  it('computes a normal sub-100 share correctly from totalSpending', () => {
    expect(smallBizSharePct({ satTotal: 30e6, totalSpending: 120e6 })).toBeCloseTo(25, 5);
  });

  it('returns null when it cannot be computed honestly', () => {
    expect(smallBizSharePct({ satTotal: 0, totalSpending: 100 })).toBeNull();
    expect(smallBizSharePct({ satTotal: 50, totalSpending: 0 })).toBeNull();
    expect(smallBizSharePct({})).toBeNull();
  });

  it('prefers satBase over totalSpending even when both are present', () => {
    // base=200 → 25%, not totalSpending=50 → 100%.
    expect(smallBizSharePct({ satTotal: 50, satBase: 200, totalSpending: 50 })).toBeCloseTo(25, 5);
  });
});
