import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KeywordCoverage } from './keyword-coverage';

/**
 * The shared market-scope decision. These pin the two properties that keep Mindy's
 * surfaces reconcilable: the canonical filter shape, and how a dominant-NAICS keyword
 * falls through (the case that used to 404 an entire panel).
 */

const keywordCoverageMock = vi.fn();
vi.mock('./keyword-coverage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./keyword-coverage')>()),
  keywordCoverage: (kw: string) => keywordCoverageMock(kw),
}));

import { resolveMarketScope, buildSpendingFilters, filtersForScope, CONTRACT_AWARD_TYPE_CODES } from './spend-query';

function cov(over: Partial<KeywordCoverage> = {}): KeywordCoverage {
  return {
    keyword: 'drones',
    totalMarket: 243_000_000,
    naicsCount: 42,
    allNaics: [
      { code: '336411', name: 'Aircraft Manufacturing', amount: 68_000_000, pct: 0.284 },
      { code: '334511', name: 'Search & Navigation', amount: 41_000_000, pct: 0.172 },
    ],
    coverageCodes: ['336411', '334511'],
    coveragePct: 0.91,
    topCodePct: 0.284,
    leadCodePct: 0.284,
    pscCount: 12,
    topPsc: { code: '1550', name: 'Unmanned Aircraft' },
    topPscPct: 0.55,
    topPscList: [],
    ...over,
  } as KeywordCoverage;
}

beforeEach(() => keywordCoverageMock.mockReset());

describe('buildSpendingFilters — the canonical filter', () => {
  it('always pins contracts-only + the fixed 3-FY window', () => {
    const f = buildSpendingFilters({ naicsCodes: ['541512'] });
    expect(f.award_type_codes).toEqual(CONTRACT_AWARD_TYPE_CODES); // A/B/C/D, no grants/loans
    expect(f.time_period).toBeDefined();
    expect(f.naics_codes).toEqual(['541512']);
  });

  it('applies place-of-performance only when a state is given', () => {
    expect(buildSpendingFilters({ naicsCodes: ['541512'] }).place_of_performance_locations).toBeUndefined();
    expect(buildSpendingFilters({ naicsCodes: ['541512'], state: 'FL' }).place_of_performance_locations)
      .toEqual([{ country: 'USA', state: 'FL' }]);
  });

  it('a marketFilter takes precedence over naicsCodes (keyword ranks by what was bought)', () => {
    const f = buildSpendingFilters({ marketFilter: { keywords: ['drones'], mode: 'keyword' }, naicsCodes: ['999999'] });
    expect(f.naics_codes).toBeUndefined();
    expect(f.keywords).toEqual(['drones']);
  });
});

describe('resolveMarketScope', () => {
  it('a cross-cutting keyword ranks by keyword', async () => {
    keywordCoverageMock.mockResolvedValue(cov());
    const s = (await resolveMarketScope({ keyword: 'drones' }))!;
    expect(s.basis).toBe('keyword');
    expect(s.rankedByDominantNaics).toBe(false);
    expect(s.marketFilter).not.toBeNull();
    expect(s.naicsCodes).toEqual([]);
  });

  it('an explicit 6-digit NAICS stays EXACT (never sweeps the subsector)', async () => {
    const s = (await resolveMarketScope({ naics: '541512' }))!;
    expect(s.basis).toBe('naics');
    expect(s.naicsCodes).toEqual(['541512']); // not all of 541xxx
    expect(s.coverage).toBeNull();
  });

  // The bug this lib exists to kill: fpds-top-n returned
  // `No federal market found for keyword "security guard"` — for a $6B market.
  /**
   * Updated 2026-08-15 (the hypersonics scope leak). This block used to assert that a
   * dominant keyword resolved to basis 'naics' with marketFilter null — which ALSO
   * dropped the keyword, so every section measured the whole code. The intent it was
   * protecting (rank by the LEAD code, never the coverage set) is unchanged and still
   * asserted; it is now expressed as a 'keyword_naics' filter that keeps the keyword.
   */
  describe('coverage lead share does not become NAICS identity', () => {
    const concentrated = (over: Partial<KeywordCoverage> = {}) => cov({
      keyword: 'security guard',
      allNaics: [{ code: '561612', name: 'Security Guards and Patrol Services', amount: 5_991_000_000, pct: 0.998 }],
      coverageCodes: ['561612'],
      topCodePct: 0.998,
      leadCodePct: 0.998,
      ...over,
    });

    it('returns a real keyword scope instead of null/no-market', async () => {
      keywordCoverageMock.mockResolvedValue(concentrated());
      const s = (await resolveMarketScope({ keyword: 'security guard' }))!;
      expect(s).not.toBeNull();
      expect(s.basis).toBe('keyword');
      expect(s.rankedByDominantNaics).toBe(false);
      expect(s.marketFilter).not.toBeNull();
      expect(s.marketFilter!.naics_codes).toBeUndefined();
      expect(s.marketFilter!.keywords).toEqual(['security guard']);
      expect(s.label).toContain('security guard');
      expect(s.coverage).not.toBeNull();
    });

    it('does not collapse roofing to 238160 because the lead share is high', async () => {
      keywordCoverageMock.mockResolvedValue(cov({
        keyword: 'roofing',
        allNaics: [
          { code: '238160', name: 'Roofing Contractors', amount: 450_000_000, pct: 0.779 },
          { code: '236220', name: 'Commercial and Institutional Building Construction', amount: 79_000_000, pct: 0.136 },
        ],
        coverageCodes: ['238160', '236220'],
        topCodePct: 0.779,
        leadCodePct: 0.779,
      }));
      const s = (await resolveMarketScope({ keyword: 'roofing' }))!;
      const f = filtersForScope(s);
      expect(f.naics_codes).toBeUndefined();
      expect(f.keywords).toEqual(['roofing']);
      expect(s.rankedByDominantNaics).toBe(false);
    });

    it('labels the basis as the keyword, not the lead NAICS', async () => {
      keywordCoverageMock.mockResolvedValue(concentrated());
      const s = (await resolveMarketScope({ keyword: 'security guard' }))!;
      expect(s.label).toBe('keyword "security guard"');
    });
  });

  it('returns null (an honest miss) when there is nothing to resolve', async () => {
    expect(await resolveMarketScope({})).toBeNull();
  });

  it('returns null when coverage comes back empty rather than inventing a market', async () => {
    keywordCoverageMock.mockResolvedValue(null);
    expect(await resolveMarketScope({ keyword: 'zzznothing' })).toBeNull();
  });

  it('accepts an injected coverage without re-querying', async () => {
    const s = (await resolveMarketScope({ keyword: 'drones', coverage: cov() }))!;
    expect(s.basis).toBe('keyword');
    expect(keywordCoverageMock).not.toHaveBeenCalled();
  });
});
