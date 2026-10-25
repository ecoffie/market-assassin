import { describe, it, expect } from 'vitest';
import { tallyOpenMarket, countOpenMarket, type OpenMarketKeyRow } from './open-market-count';

const r = (solicitation_number: string | null, notice_id: string | null, map_lat: number | null): OpenMarketKeyRow => ({ solicitation_number, notice_id, map_lat });

describe('tallyOpenMarket — one listing per solicitation, with or without coordinates', () => {
  it('several amendments of one listing count once; mapped if ANY amendment has a pin', () => {
    const t = tallyOpenMarket([r('A', 'n1', 1), r('A', 'n2', null), r('a ', 'n3', null)]);
    expect(t).toEqual({ mapped: 1, market: 1, unmapped: 0 });
  });
  it('a locationless listing with many amendments is ONE unmapped listing (raw rows said 4)', () => {
    expect(tallyOpenMarket(['n1', 'n2', 'n3', 'n4'].map((id) => r('B', id, null)))).toEqual({ mapped: 0, market: 1, unmapped: 1 });
  });
  it('solicitation-less notices stay distinct; unusable rows are dropped', () => {
    expect(tallyOpenMarket([r(null, 'n1', 1), r(null, 'n2', null), r(null, null, 1)])).toEqual({ mapped: 1, market: 2, unmapped: 1 });
  });
  it('mapped + unmapped === market by construction', () => {
    const t = tallyOpenMarket([r('A', 'n1', 1), r('B', 'n2', null), r('B', 'n3', null), r('C', 'n4', 2), r('C', 'n5', null)]);
    expect(t.mapped + t.unmapped).toBe(t.market);
  });
});

describe('countOpenMarket — pages past the 1,000-row cap through the caller filters', () => {
  function db(total: number, fail = false) {
    const seen: string[] = [];
    return {
      seen,
      from: () => {
        let lo = 0, hi = 0;
        const q = {
          select: (cols: string) => { seen.push(cols); return q; },
          order: () => q,
          range: (a: number, b: number) => { lo = a; hi = b; return q; },
          then: (res: (v: unknown) => unknown) => res(fail ? { data: null, count: null, error: new Error('boom') } : {
            data: Array.from({ length: Math.max(0, Math.min(hi, total - 1) - lo + 1) }, (_, i) => r(`S${Math.floor((lo + i) / 2)}`, `n${lo + i}`, (lo + i) % 4 === 0 ? null : 1)),
            count: total, error: null,
          }),
        };
        return q;
      },
    };
  }
  it('walks every page and applies the filters to each', async () => {
    const d = db(2500);
    let applied = 0;
    const t = await countOpenMarket(d, (q) => { applied++; return q; });
    expect(applied).toBe(3);
    expect(t.market).toBe(1250);                         // 2 amendments per listing
    expect(t.mapped + t.unmapped).toBe(t.market);
    expect(d.seen.every((c) => c === 'solicitation_number, notice_id, map_lat')).toBe(true);
  });
  it('a query error throws — never a 0', async () => {
    await expect(countOpenMarket(db(0, true), (q) => q)).rejects.toThrow('boom');
  });
});
