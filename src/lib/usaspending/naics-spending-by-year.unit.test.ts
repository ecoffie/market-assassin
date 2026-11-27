import { describe, expect, it } from 'vitest';
import { getNaicsSpendingByYear, normalizeNaicsList, resolveFyRange } from './naics-spending-by-year';

const NOW = new Date('2026-11-22T00:00:00Z'); // latest complete FY = 2026

function mockFetch(byKind: Record<string, Array<[number, number]> | 'fail'>) {
  const calls: Array<Record<string, unknown>> = [];
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push(body.filters);
    const kind = body.filters.recipient_type_names ? 'sb' : body.filters.set_aside_type_codes ? 'aside' : 'total';
    const spec = byKind[kind];
    if (spec === 'fail') return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: spec.map(([fy, amt]) => ({ aggregated_amount: amt, time_period: { fiscal_year: String(fy) } })) }),
    };
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('naics-spending-by-year', () => {
  it('normalizes and de-dupes NAICS, rejects junk', () => {
    expect(normalizeNaicsList('541512, 541512 236220 abc 1234567')).toEqual({ valid: ['541512', '236220'], invalid: ['abc', '1234567'] });
  });

  it('defaults to the last 5 complete FYs and caps the span', () => {
    expect(resolveFyRange(undefined, undefined, NOW)).toEqual({ from: 2022, to: 2026, error: null });
    expect(resolveFyRange(2010, 2026, NOW).error).toMatch(/At most/);
  });

  it('computes per-year and total small-business shares', async () => {
    const { f, calls } = mockFetch({
      total: [[2025, 1000], [2026, 2000]],
      sb: [[2025, 400], [2026, 500]],
      aside: [[2025, 200]],
    });
    const r = await getNaicsSpendingByYear({ naics: '541512', from_fy: 2025, to_fy: 2026, state: 'Florida' }, f, NOW);
    expect(r.years).toEqual([
      { fiscal_year: 2025, total_obligated: 1000, small_business_won: 400, small_business_won_pct: 40, sb_set_aside_obligated: 200, sb_set_aside_pct: 20 },
      // set-aside call SUCCEEDED with no 2026 row → a real $0, not null
      { fiscal_year: 2026, total_obligated: 2000, small_business_won: 500, small_business_won_pct: 25, sb_set_aside_obligated: 0, sb_set_aside_pct: 0 },
    ]);
    expect(r.totals.small_business_won_pct).toBe(30);
    expect(r.state).toBe('FL');
    // 6-digit NAICS is exact; contracts only; place of performance filter applied
    expect(calls[0].naics_codes).toEqual({ require: ['541512'] });
    expect(calls[0].award_type_codes).toEqual(['A', 'B', 'C', 'D']);
    expect(calls[0].place_of_performance_locations).toEqual([{ country: 'USA', state: 'FL' }]);
  });

  it('a FAILED series is null (unknown), never 0', async () => {
    const { f } = mockFetch({ total: [[2026, 1000]], sb: 'fail', aside: [[2026, 100]] });
    const r = await getNaicsSpendingByYear({ naics: '541512', from_fy: 2026, to_fy: 2026 }, f, NOW);
    expect(r.failed).toEqual(['small_business']);
    expect(r.years[0].small_business_won).toBeNull();
    expect(r.years[0].small_business_won_pct).toBeNull();
    expect(r.totals.small_business_won).toBeNull();
    expect(r.years[0].sb_set_aside_pct).toBe(10);
  });

  it('validation errors make no network call', async () => {
    const { f, calls } = mockFetch({ total: [], sb: [], aside: [] });
    expect((await getNaicsSpendingByYear({ naics: 'xyz' }, f, NOW)).validation_error).toMatch(/NAICS/);
    expect((await getNaicsSpendingByYear({ naics: '541512', state: 'Atlantis' }, f, NOW)).validation_error).toMatch(/state/);
    expect(calls).toHaveLength(0);
  });
});
