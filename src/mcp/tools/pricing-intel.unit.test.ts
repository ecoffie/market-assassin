import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PricingIntelData } from '@/lib/utils/calc-rates';

// A plain function, not vi.fn: a spy that returns a rejected promise is reported by vitest as
// an unhandled rejection even when the code under test catches it.
let impl: (...a: unknown[]) => Promise<unknown> = async () => null;
const calls: unknown[][] = [];
vi.mock('@/lib/utils/calc-rates', () => ({
  fetchPricingIntel: async () => null,
  fetchPricingIntelByKeywords: (...a: unknown[]) => { calls.push(a); return impl(...a); },
}));
// No cache in tests: run the fetcher directly.
vi.mock('@/lib/mcp/external-cache', () => ({
  withCache: async (_t: string, _p: unknown, _ttl: number, f: () => Promise<unknown>) => ({ value: await f(), fromCache: false }),
}));

import { getPricingIntel, buildRateSummary } from './pricing-intel';
import { grade } from '@/lib/chat/eval/grade';

function data(over: Partial<PricingIntelData> = {}): PricingIntelData {
  return {
    laborCategories: [
      { category: 'Material Handler', recordCount: 6, median: 38.39, titleMedian: 38.39, percentile25: 32.2, percentile75: 43.99, min: 26.61, max: 62.38, avg: 40.29, nextYearMedian: 39.04 },
    ],
    businessSizeComparison: { smallBusiness: { median: 43.93, count: 34, avg: 45.28 }, largeBusiness: { median: 53.74, count: 16, avg: 51.63 }, gapPercent: 18.25 },
    rateDistribution: [],
    priceToWinGuidance: { aggressiveRate: 35.34, competitiveRate: 44.08, premiumRate: 52.53 },
    priceToWinBasis: { source: 'calc_server_aggregation', searchTerm: 'Material Handler', n: 50 },
    topVendors: [],
    naicsCode: '',
    naicsDescription: 'Material Handler',
    searchTermsUsed: ['Material Handler'],
    totalRecordsAnalyzed: 50,
    queryDate: '2026-11-13T00:00:00Z',
    ...over,
  };
}

describe('buildRateSummary (R7)', () => {
  it('labels every rate with its population and n, ordered aggressive <= competitive <= premium', () => {
    const s = buildRateSummary(data());
    expect(s.rates.map((r) => [r.label, r.percentile, r.hourly, r.n])).toEqual([
      ['aggressive', 25, 35.34, 50],
      ['competitive', 50, 44.08, 50],
      ['premium', 75, 52.53, 50],
    ]);
    for (const r of s.rates) expect(r.population).toBe('all CALC records matching "Material Handler"');
    expect(s.ordering_holds).toBe(true);
    expect(s.market_median).toEqual({ hourly: 44.08, percentile: 50, same_as: 'competitive', n: 50 });
    expect(s.by_business_size.small).toMatchObject({ median: 43.93, n: 34 });
  });

  it('keeps the per-title median separate and labelled as a subset', () => {
    const s = buildRateSummary(data());
    expect(s.per_title_medians[0]).toMatchObject({ title: 'Material Handler', title_median: 38.39, n: 6 });
    expect(s.per_title_medians[0].population).toMatch(/subset; not the market rate population/);
  });

  it('statement states all price points so the regression grader sees a correct order', () => {
    const s = buildRateSummary(data());
    expect(s.statement).toContain('$35.34');
    expect(s.statement).toContain('$44.08');
    expect(s.statement).toContain('$52.53');
    const g = grade({ id: 'R7', prompt: 'GSA rates for Material Handler', price_order: true } as never, s.statement, []);
    expect(g.failures.filter((f) => f.startsWith('price_order'))).toEqual([]);
    expect(g.partials).not.toContain('price_points_not_all_stated');
  });

  it('reports an ordering violation instead of hiding it', () => {
    const s = buildRateSummary(data({ priceToWinGuidance: { aggressiveRate: 50, competitiveRate: 44, premiumRate: 52 } }));
    expect(s.ordering_holds).toBe(false);
    expect(s.statement).toMatch(/NOT satisfied/);
  });
});

describe('getPricingIntel degraded vs empty', () => {
  beforeEach(() => { calls.length = 0; impl = async () => null; });

  it('grounded result carries rate_summary and keeps the old pricing payload', async () => {
    impl = async () => data();
    const r = await getPricingIntel({ keyword: 'Material Handler' });
    expect(r._meta).toMatchObject({ grounded: true, degraded: false });
    expect(r.pricing?.priceToWinGuidance.competitiveRate).toBe(44.08);
    expect(r.rate_summary?.rates).toHaveLength(3);
    expect(calls[0]).toEqual(['Material Handler', { throwOnUpstreamError: true }]);
  });

  it('CALC returning nothing is an honest empty, not degraded', async () => {
    impl = async () => null;
    const r = await getPricingIntel({ keyword: 'Zzyzx Operator' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: false });
    expect(r.rate_summary).toBeUndefined();
  });

  it('CALC failing (e.g. 429 on every term) is degraded, not empty', async () => {
    impl = async () => { throw new Error('CALC+ unavailable: CALC+ API error: 429'); };
    const r = await getPricingIntel({ keyword: 'Material Handler' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true });
  });
});
