import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPricingIntelByKeywords } from './calc-rates';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function calcPage(prices: number[], agg?: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      hits: {
        total: { value: prices.length, relation: 'eq' },
        hits: prices.map((p, i) => ({ _source: { labor_category: i % 2 ? 'Material Handler' : 'Material Handler I', current_price: p, next_year_price: null, vendor_name: `V${i}`, business_size: 'S' } })),
      },
      aggregations: agg,
    }),
  } as unknown as Response;
}

describe('fetchPricingIntelByKeywords upstream failure (R7 degraded vs empty)', () => {
  it('returns null when CALC errors by default, and throws when the caller asks', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response) as typeof fetch;
    await expect(fetchPricingIntelByKeywords('Material Handler')).resolves.toBeNull();
    await expect(fetchPricingIntelByKeywords('Material Handler', { throwOnUpstreamError: true })).rejects.toThrow(/CALC\+ unavailable/);
  });

  it('a genuine zero-match search is null even with throwOnUpstreamError', async () => {
    globalThis.fetch = vi.fn(async () => calcPage([])) as typeof fetch;
    await expect(fetchPricingIntelByKeywords('Zzyzx', { throwOnUpstreamError: true })).resolves.toBeNull();
  });
});

describe('price-to-win population', () => {
  it('uses the server aggregation for all three rates and labels it', async () => {
    const agg = { histogram_percentiles: { values: { '25.0': 35.34, '50.0': 44.0, '75.0': 52.53 } }, median_price: { values: { '50.0': 44.08 } }, wage_stats: { count: 50, avg: 45, min: 20, max: 70, std_deviation: 5 } };
    globalThis.fetch = vi.fn(async () => calcPage([30, 40, 50, 60], agg)) as typeof fetch;
    const d = await fetchPricingIntelByKeywords('Material Handler');
    expect(d!.priceToWinGuidance).toEqual({ aggressiveRate: 35.34, competitiveRate: 44.08, premiumRate: 52.53 });
    expect(d!.priceToWinBasis).toEqual({ source: 'calc_server_aggregation', searchTerm: 'Material Handler', n: 50 });
    expect(d!.laborCategories[0].titleMedian).toBe(d!.laborCategories[0].median);
  });

  it('never mixes a server median with local quartiles', async () => {
    // Server gives only a median (no quartiles): all three must come from the local records.
    const agg = { median_price: { values: { '50.0': 99 } }, wage_stats: { count: 4, avg: 45, min: 30, max: 60, std_deviation: 5 } };
    globalThis.fetch = vi.fn(async () => calcPage([30, 40, 50, 60], agg)) as typeof fetch;
    const d = await fetchPricingIntelByKeywords('Material Handler');
    const p = d!.priceToWinGuidance;
    expect(p.aggressiveRate).toBeLessThanOrEqual(p.competitiveRate);
    expect(p.competitiveRate).toBeLessThanOrEqual(p.premiumRate);
    expect(p.competitiveRate).not.toBe(99);
    expect(d!.priceToWinBasis!.source).toBe('local_fetched_records');
  });
});
