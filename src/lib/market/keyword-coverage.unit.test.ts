import { describe, it, expect } from 'vitest';
import {
  isGenericPsc,
  pscLiteralProduct,
  buildMarketFilter,
  marketFilterToUsaspending,
  deriveCoverageKeywords,
  buildSearchKeywords,
  type KeywordCoverage,
} from './keyword-coverage';

/**
 * Keyword-first market logic (the "drones = 70+ NAICS, obvious code = 28%" lesson).
 * These lock the PURE, network-free pieces — especially the gate that only attaches
 * a PSC when it's the LITERAL product (memory: naics_vs_psc_search). No USASpending
 * calls here; the async keywordCoverage() is out of scope for a unit test.
 */

function coverage(over: Partial<KeywordCoverage> = {}): KeywordCoverage {
  return {
    keyword: 'drones',
    totalMarket: 243_000_000,
    naicsCount: 70,
    allNaics: [
      { code: '336411', name: 'Aircraft Manufacturing', amount: 68_000_000, pct: 0.28 },
      { code: '541715', name: 'Research and Development', amount: 40_000_000, pct: 0.16 },
    ],
    coverageCodes: ['336411', '541715'],
    coveragePct: 0.9,
    topCodePct: 0.28,
    pscCount: 12,
    topPsc: { code: '1550', name: 'Unmanned Aircraft' },
    topPscPct: 0.55,
    topPscList: [{ code: '1550', name: 'Unmanned Aircraft', amount: 130_000_000, pct: 0.55 }],
    ...over,
  };
}

describe('isGenericPsc', () => {
  it('treats an empty/undefined name as generic (safe default)', () => {
    expect(isGenericPsc('')).toBe(true);
    expect(isGenericPsc(null)).toBe(true);
    expect(isGenericPsc(undefined)).toBe(true);
  });

  it('a specific product name is NOT generic', () => {
    expect(isGenericPsc('Unmanned Aircraft')).toBe(false);
  });
});

describe('pscLiteralProduct — PSC must literally describe the product', () => {
  it('matches when the PSC name contains the keyword', () => {
    expect(pscLiteralProduct('aircraft', 'Unmanned Aircraft')).toBe(true);
  });

  it('matches on a significant (>=4 char) token overlap', () => {
    expect(pscLiteralProduct('demolition services', 'Demolition of Structures')).toBe(true);
  });

  it('does NOT match unrelated names', () => {
    expect(pscLiteralProduct('drones', 'Office Furniture')).toBe(false);
  });

  it('returns false on empty inputs', () => {
    expect(pscLiteralProduct('', 'Unmanned Aircraft')).toBe(false);
    expect(pscLiteralProduct('drones', '')).toBe(false);
  });
});

describe('buildMarketFilter — keyword-first, PSC only when literal', () => {
  it('attaches the PSC when it is specific, >=40%, and the literal product', () => {
    const f = buildMarketFilter({ coverage: coverage({ keyword: 'aircraft', topPsc: { code: '1550', name: 'Unmanned Aircraft' }, topPscPct: 0.55 }) })!;
    expect(f.mode).toBe('keyword_psc');
    expect(f.keywords).toEqual(['aircraft']);
    expect(f.psc_codes).toEqual(['1550']);
  });

  it('drops the PSC when it is below the 40% concentration threshold', () => {
    const f = buildMarketFilter({ coverage: coverage({ keyword: 'aircraft', topPscPct: 0.30 }) })!;
    expect(f.mode).toBe('keyword'); // keyword-only
    expect(f.psc_codes).toBeUndefined();
  });

  it('drops the PSC when it is NOT the literal product (related category only)', () => {
    // topPsc is concentrated but doesn't describe the keyword → keyword-only.
    const f = buildMarketFilter({ coverage: coverage({ keyword: 'drones', topPsc: { code: '9999', name: 'Office Furniture' }, topPscPct: 0.6 }) })!;
    expect(f.mode).toBe('keyword');
  });

  it('NEVER returns NAICS (eligibility-only, not a discovery filter)', () => {
    const f = buildMarketFilter({ coverage: coverage() })!;
    expect(f).not.toHaveProperty('naics_codes');
  });

  it('falls back to a raw PSC filter when only a pscCode is given', () => {
    const f = buildMarketFilter({ pscCode: '1550' })!;
    expect(f.mode).toBe('psc');
    expect(f.psc_codes).toEqual(['1550']);
  });

  it('returns null when there is nothing to filter on', () => {
    expect(buildMarketFilter({})).toBeNull();
  });
});

describe('marketFilterToUsaspending — merge into USAspending fields', () => {
  it('adds keywords + psc_codes and preserves the base filter', () => {
    const out = marketFilterToUsaspending(
      { keywords: ['drones'], psc_codes: ['1550'], mode: 'keyword_psc', rankingLabel: '' },
      { time_period: [{ start_date: '2024-10-01' }] },
    );
    expect(out.keywords).toEqual(['drones']);
    expect(out.psc_codes).toEqual(['1550']);
    expect(out.time_period).toBeDefined(); // base preserved
    expect(out).not.toHaveProperty('naics_codes');
  });
});

describe('deriveCoverageKeywords — grounded search terms', () => {
  it('leads with the keyword + the top PSC product name, then NAICS signal words', () => {
    const kws = deriveCoverageKeywords(coverage());
    expect(kws[0]).toBe('drones');
    expect(kws).toContain('unmanned aircraft');
    // pulls a significant word from a buying NAICS title (not a stopword)
    expect(kws).toContain('aircraft');
  });

  it('dedupes and drops stopwords / short tokens', () => {
    const kws = deriveCoverageKeywords(coverage({ keyword: 'aircraft' }));
    expect(new Set(kws).size).toBe(kws.length);         // no dupes
    expect(kws).not.toContain('and');                    // stopword gone
    expect(kws.every((k) => k.length >= 3)).toBe(true);  // no short tokens
  });
});

describe('buildSearchKeywords — union of coverage + profile', () => {
  it('merges coverage-derived keywords with profile keywords, capped at 6', () => {
    const kws = buildSearchKeywords({ coverage: coverage(), profileKeywords: ['isr', 'surveillance'] });
    expect(kws).toContain('drones');
    expect(kws).toContain('isr');
    expect(kws.length).toBeLessThanOrEqual(6);
  });

  it('uses the raw keyword when no coverage is supplied', () => {
    const kws = buildSearchKeywords({ keyword: 'cybersecurity', profileKeywords: [] });
    expect(kws).toEqual(['cybersecurity']);
  });
});
