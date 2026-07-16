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
    // For the drones fixture the lead IS the biggest (336411), so both read 0.28.
    // They diverge only when the right-lead logic promotes a smaller code — see the
    // "lead vs biggest" block below.
    topCodePct: 0.28,
    leadCodePct: 0.28,
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

  it('DOMINANT-NAICS: a keyword whose market concentrates in one code ranks by NAICS (null filter)', () => {
    // "commercial & institutional building construction" → 236220 is the majority
    // (>=40%) → suppress keyword/PSC ranking so callers fall through to NAICS.
    // Fixes NASA-over-DOD for 236220 (airfield PSC would otherwise win).
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'commercial and institutional building construction',
      topCodePct: 0.68,
      leadCodePct: 0.68, // the lead IS 236220 here — keyword and dominant code agree
      topPsc: { code: 'Y1BZ', name: 'Construction of Other Airfield Structures' },
      topPscPct: 0.45,
    }) });
    expect(f).toBeNull();
  });

  /**
   * The lead-vs-biggest split. allNaics is NOT amount-sorted — the right-lead logic
   * promotes the semantically-correct code — so topCodePct (biggest, DISPLAYED) and
   * leadCodePct (the lead, the GATE's input) are different questions. They used to be
   * one field, which printed "biggest NAICS = only 0%" on a client report for drones.
   */
  describe('lead vs biggest (the gate reads the LEAD)', () => {
    // "hvac": lead 238220 Plumbing/HVAC Contractors 20.5% (the specialty trade) while
    // 236220 General Building holds 55.6% — big building contracts merely MENTION hvac.
    const hvac = (over: Partial<KeywordCoverage> = {}) => coverage({
      keyword: 'hvac',
      allNaics: [
        { code: '238220', name: 'Plumbing, Heating, and Air-Conditioning Contractors', amount: 245_000_000, pct: 0.205 },
        { code: '236220', name: 'Commercial and Institutional Building Construction', amount: 664_000_000, pct: 0.556 },
      ],
      topCodePct: 0.556,  // biggest by $ — 236220
      leadCodePct: 0.205, // the lead — 238220
      topPsc: { code: 'Z2AA', name: 'Repair or Alteration of Office Buildings' },
      topPscPct: 0.30,
      ...over,
    });

    it('does NOT fire the dominant gate when only a NON-lead code is dominant', () => {
      // Gating on topCodePct (55.6%) would push hvac into NAICS ranking led by GENERAL
      // CONSTRUCTION — surfacing general contractors for an HVAC search. Eric, Jul 16:
      // "it should be 238 since it's a specialty trade."
      const f = buildMarketFilter({ coverage: hvac() });
      expect(f).not.toBeNull();
      expect(f!.mode).toBe('keyword');
    });

    it('fires the gate when the LEAD itself is dominant', () => {
      expect(buildMarketFilter({ coverage: hvac({ leadCodePct: 0.556 }) })).toBeNull();
    });

    it('a dominant biggest code cannot suppress ranking on its own', () => {
      // Regression: the two fields must stay independent.
      const f = buildMarketFilter({ coverage: hvac({ topCodePct: 0.99 }) });
      expect(f).not.toBeNull();
    });
  });

  it('CROSS-CUTTING: a sprawling keyword (drones, top code ~28%) keeps keyword/PSC ranking', () => {
    // Below DOMINANT_NAICS_SHARE (0.40) → still ranks by keyword/PSC, not NAICS.
    const f = buildMarketFilter({ coverage: coverage() })!;
    expect(f).not.toBeNull();
    expect(f.mode).toBe('keyword'); // still keyword-ranked, NOT suppressed to NAICS
    expect(f).not.toHaveProperty('naics_codes');
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
