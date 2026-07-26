import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB client so we test the pure aggregation + verdict logic without a live Supabase.
const mockLimit = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({
    from: () => ({
      select: () => ({
        is: () => ({
          or: () => ({
            limit: mockLimit,
            eq: () => ({ limit: mockLimit }),
          }),
        }),
      }),
    }),
  }),
}));

import { computeBuyerBehavior } from './buyer-behavior';

function rows(spec: { type: string; value?: number }[]) {
  return spec.map((s) => ({ contract_type: s.type, potential_total_value: s.value ?? 0 }));
}

describe('computeBuyerBehavior', () => {
  beforeEach(() => mockLimit.mockReset());

  it('flags a PO-heavy buyer as small-business friendly (DLA-shape, ~36% PO)', async () => {
    // 10 rows: 4 PO (40%), 3 delivery, 3 definitive
    mockLimit.mockResolvedValue({
      data: rows([
        { type: 'PURCHASE ORDER', value: 100000 }, { type: 'PURCHASE ORDER', value: 120000 },
        { type: 'PURCHASE ORDER', value: 90000 }, { type: 'PURCHASE ORDER', value: 110000 },
        { type: 'DELIVERY ORDER', value: 5000000 }, { type: 'DELIVERY ORDER', value: 4000000 },
        { type: 'DELIVERY ORDER', value: 6000000 },
        { type: 'DEFINITIVE CONTRACT', value: 2000000 }, { type: 'DEFINITIVE CONTRACT', value: 1500000 },
        { type: 'DEFINITIVE CONTRACT', value: 1800000 },
      ]),
      error: null,
    });
    const b = await computeBuyerBehavior('Defense Logistics Agency');
    expect(b.grounded).toBe(true);
    expect(b.sampleSize).toBe(10);
    expect(b.poPct).toBe(40);
    expect(b.verdict.tone).toBe('friendly');
    expect(b.verdict.label).toMatch(/small-business friendly/i);
    // every number in the story must trace to the data — the PO% is quoted verbatim
    expect(b.verdict.detail).toContain('40%');
  });

  it('flags a delivery-order-heavy buyer as vehicle-gated', async () => {
    mockLimit.mockResolvedValue({
      data: rows([
        ...Array(6).fill({ type: 'DELIVERY ORDER', value: 3000000 }),
        { type: 'PURCHASE ORDER', value: 100000 },
        ...Array(3).fill({ type: 'DEFINITIVE CONTRACT', value: 2000000 }),
      ]),
      error: null,
    });
    const b = await computeBuyerBehavior('Department of the Army');
    expect(b.grounded).toBe(true);
    expect(b.deliveryPct).toBe(60);
    expect(b.verdict.tone).toBe('gated');
    expect(b.verdict.label).toMatch(/vehicle-gated/i);
  });

  it('returns grounded:false (placeholder) below the min sample — never a fabricated mix', async () => {
    mockLimit.mockResolvedValue({ data: rows([{ type: 'PURCHASE ORDER' }, { type: 'DELIVERY ORDER' }]), error: null });
    const b = await computeBuyerBehavior('Tiny Agency');
    expect(b.grounded).toBe(false);
    expect(b.poPct).toBe(0);
    expect(b.verdict.label).toBe('Not enough data');
  });

  it('fails soft on a DB error — grounded:false, no throw', async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const b = await computeBuyerBehavior('Some Agency');
    expect(b.grounded).toBe(false);
    expect(b.sampleSize).toBe(0);
  });

  it('returns grounded:false when no agency is given', async () => {
    const b = await computeBuyerBehavior('');
    expect(b.grounded).toBe(false);
  });

  it('computes the median award value', async () => {
    mockLimit.mockResolvedValue({
      data: rows([
        { type: 'PURCHASE ORDER', value: 100 }, { type: 'PURCHASE ORDER', value: 200 },
        { type: 'PURCHASE ORDER', value: 300 }, { type: 'PURCHASE ORDER', value: 400 },
        { type: 'DELIVERY ORDER', value: 500 }, { type: 'DELIVERY ORDER', value: 600 },
        { type: 'DEFINITIVE CONTRACT', value: 700 }, { type: 'DEFINITIVE CONTRACT', value: 800 },
      ]),
      error: null,
    });
    const b = await computeBuyerBehavior('Median Test');
    expect(b.medianValue).toBe(450); // (400+500)/2
  });
});
