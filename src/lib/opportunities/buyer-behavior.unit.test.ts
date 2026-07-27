import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The compute now uses EXACT head-counts (no row sampling for the mix): one total count + one count
 * per contract_type bucket + a bounded value pull for the median. We mock a chainable query builder
 * that resolves based on which filters were applied on the chain:
 *   - `.gt('potential_total_value', …)` present  → the MEDIAN value pull → resolves { data }
 *   - `.eq('contract_type', X)` / `.ilike('contract_type', 'BPA%')` → a BUCKET count → resolves { count }
 *   - neither                                     → the TOTAL count → resolves { count: total }
 * The test drives it purely with the type MIX (counts), not raw rows.
 */
let scenario: { total: number; byType: Record<string, number>; countError?: string; values?: number[] };

function makeBuilder(state: { ctype?: string; bpa?: boolean; isMedian?: boolean }): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain; b.is = chain; b.or = chain;
  b.eq = (col: string, val: string) => { if (col === 'contract_type') state.ctype = val; return b; };
  b.ilike = (col: string) => { if (col === 'contract_type') state.bpa = true; return b; };
  b.gt = () => { state.isMedian = true; return b; };
  b.limit = () => b;
  // Thenable: awaiting the builder resolves the right shape for the accumulated filters.
  b.then = (resolve: (v: unknown) => void) => {
    if (scenario.countError) return resolve({ count: null, error: { message: scenario.countError } });
    if (state.isMedian) return resolve({ data: (scenario.values || []).map((v) => ({ potential_total_value: v })), error: null });
    if (state.bpa) return resolve({ count: scenario.byType['BPA CALL'] || 0, error: null });
    if (state.ctype) return resolve({ count: scenario.byType[state.ctype] || 0, error: null });
    return resolve({ count: scenario.total, error: null }); // the total count
  };
  return b;
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ from: () => makeBuilder({}) }),
}));

import { computeBuyerBehavior } from './buyer-behavior';

describe('computeBuyerBehavior (exact-count model)', () => {
  beforeEach(() => { scenario = { total: 0, byType: {} }; });

  it('flags a PO-heavy buyer as small-business friendly (DLA-shape) using EXACT full-population counts', async () => {
    // 100 awards: 40 PO (40%), 30 delivery, 30 definitive — exact counts, no sampling.
    scenario = { total: 100, byType: { 'PURCHASE ORDER': 40, 'DELIVERY ORDER': 30, 'DEFINITIVE CONTRACT': 30 }, values: [90000, 110000, 5000000] };
    const b = await computeBuyerBehavior('Defense Logistics Agency');
    expect(b.grounded).toBe(true);
    expect(b.sampleSize).toBe(100);
    expect(b.poPct).toBe(40);
    expect(b.verdict.tone).toBe('friendly');
    expect(b.verdict.label).toMatch(/small-business friendly/i);
    // every number in the story must trace to the data — the PO% is quoted verbatim
    expect(b.verdict.detail).toContain('40%');
    // `other` is the remainder, so the buckets + other reconcile to the exact total
    expect(b.mix.purchaseOrder + b.mix.deliveryOrder + b.mix.definitiveContract + b.mix.bpaCall + b.mix.other).toBe(100);
  });

  it('flags a delivery-order-heavy buyer as vehicle-gated', async () => {
    scenario = { total: 100, byType: { 'DELIVERY ORDER': 60, 'PURCHASE ORDER': 10, 'DEFINITIVE CONTRACT': 30 } };
    const b = await computeBuyerBehavior('Department of the Army');
    expect(b.grounded).toBe(true);
    expect(b.deliveryPct).toBe(60);
    expect(b.verdict.tone).toBe('gated');
    expect(b.verdict.label).toMatch(/vehicle-gated/i);
  });

  it('returns grounded:false (placeholder) below the min sample — never a fabricated mix', async () => {
    scenario = { total: 2, byType: { 'PURCHASE ORDER': 1, 'DELIVERY ORDER': 1 } };
    const b = await computeBuyerBehavior('Tiny Agency');
    expect(b.grounded).toBe(false);
    expect(b.poPct).toBe(0);
    expect(b.verdict.label).toBe('Not enough data');
  });

  it('fails soft on a DB error — grounded:false, no throw', async () => {
    scenario = { total: 0, byType: {}, countError: 'boom' };
    const b = await computeBuyerBehavior('Some Agency');
    expect(b.grounded).toBe(false);
    expect(b.sampleSize).toBe(0);
  });

  it('returns grounded:false when no agency is given', async () => {
    const b = await computeBuyerBehavior('');
    expect(b.grounded).toBe(false);
  });

  it('computes the median award value from the value pull', async () => {
    scenario = { total: 20, byType: { 'PURCHASE ORDER': 10, 'DELIVERY ORDER': 10 }, values: [100, 200, 300, 400, 500, 600, 700, 800] };
    const b = await computeBuyerBehavior('Median Test');
    expect(b.medianValue).toBe(450); // (400+500)/2
  });

  it('the mix % reflects the TRUE total, not a capped slice (regression: DLA 36%→53% preview bug)', async () => {
    // Even if far more than any sample cap, the poPct is exact against the real total.
    scenario = { total: 18680, byType: { 'PURCHASE ORDER': 6800, 'DELIVERY ORDER': 8000, 'DEFINITIVE CONTRACT': 3880 } };
    const b = await computeBuyerBehavior('Defense Logistics Agency');
    expect(b.sampleSize).toBe(18680);
    expect(b.poPct).toBe(36); // 6800/18680 = 36% — the real full-population figure
  });
});
