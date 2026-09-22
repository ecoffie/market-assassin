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
    pinnedPscCodes: null,
    transactionCount: 10,
    uniqueAwardCount: 8,
    fiscalYear: 2025,
    source: 'bigquery_usaspending_awards',
    sourceMaxActionDate: '2025-09-30',
    allAgencies: [],
    primarySense: 'work_text',
    evidenceStatus: 'MARKET_EVIDENCE_FOUND',
    naicsIdentityStatus: 'NOT_ESTABLISHED',
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

describe('buildMarketFilter — keyword-first; coverage % is not identity', () => {
  it('does not pin a measured PSC share as market identity', () => {
    const f = buildMarketFilter({ coverage: coverage({ keyword: 'aircraft', topPsc: { code: '1550', name: 'Unmanned Aircraft' }, topPscPct: 0.55 }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.psc_codes).toBeUndefined();
    expect(f.keywords).toContain('aircraft');
  });

  it('drops an unrelated concentrated PSC (still keyword-ranked)', () => {
    const f = buildMarketFilter({ coverage: coverage({ keyword: 'drones', topPsc: { code: '9999', name: 'Office Furniture' }, topPscPct: 0.6 }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.psc_codes).toBeUndefined();
  });

  it('NEVER returns NAICS from coverage lead share (eligibility-only, not identity)', () => {
    const f = buildMarketFilter({ coverage: coverage() })!;
    expect(f).not.toHaveProperty('naics_codes');
    expect(f.mode).not.toBe('keyword_naics');
  });

  it('falls back to a raw PSC filter when only a pscCode is given', () => {
    const f = buildMarketFilter({ pscCode: '1550' })!;
    expect(f.mode).toBe('psc');
    expect(f.psc_codes).toEqual(['1550']);
  });

  it('returns null when there is nothing to filter on', () => {
    expect(buildMarketFilter({})).toBeNull();
  });

  it('a concentrated keyword still ranks by the keyword, not the lead NAICS', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'commercial and institutional building construction',
      topCodePct: 0.68,
      leadCodePct: 0.68,
      topPsc: { code: 'Y1BZ', name: 'Construction of Other Airfield Structures' },
      topPscPct: 0.45,
    }) });
    expect(f).not.toBeNull();
    expect(f!.mode).toBe('keyword');
    expect(f!.psc_codes).toBeUndefined();
    expect(f!.naics_codes).toBeUndefined();
  });

  /**
   * The lead-vs-biggest split. allNaics is NOT amount-sorted — the right-lead logic
   * promotes the semantically-correct code — so topCodePct (biggest, DISPLAYED) and
   * leadCodePct (the lead, the GATE's input) are different questions. They used to be
   * one field, which printed "biggest NAICS = only 0%" on a client report for drones.
   */
  // FM-10 (Eric/QA 2026-07-28): a TERM-OF-ART keyword pinned to specific PSCs must force keyword_psc
  // scope on those PSCs — even when its lead NAICS is dominant. EOD ("explosive ordnance disposal")
  // is pinned to 1385/1386 but concentrates under NAICS 561210 (Facilities Support, dominant); the
  // dominant-NAICS path measured all $37.1B of facilities support instead of the ~$79M EOD slice.
  describe('term-of-art PSC pin wins over the dominant-NAICS gate (FM-10)', () => {
    it('a pinned coverage returns keyword_psc on the PINNED codes, even with a dominant lead', () => {
      const f = buildMarketFilter({ coverage: coverage({
        keyword: 'explosive ordnance disposal',
        pinnedPscCodes: ['1385', '1386'],
        leadCodePct: 0.62, // 561210 is dominant → without the pin this would suppress to NAICS (null)
      }) });
      expect(f).not.toBeNull();
      expect(f!.mode).toBe('keyword_psc');
      expect(f!.psc_codes).toEqual(['1385', '1386']);
    });
    it('the pin uses the PINNED codes, not the observed topPsc', () => {
      const f = buildMarketFilter({ coverage: coverage({
        keyword: 'explosive ordnance disposal',
        pinnedPscCodes: ['1385', '1386'],
        topPsc: { code: '9999', name: 'Something Else' }, topPscPct: 0.9,
      }) });
      expect(f!.psc_codes).toEqual(['1385', '1386']); // NOT ['9999']
    });
    it('no pin → keyword ranking even when the lead share is dominant', () => {
      const f = buildMarketFilter({ coverage: coverage({ pinnedPscCodes: null, leadCodePct: 0.62 }) })!;
      expect(f.mode).toBe('keyword');
      expect(f.psc_codes).toBeUndefined();
      expect(f.naics_codes).toBeUndefined();
      expect(f.keywords!.length).toBeGreaterThan(0);
    });
  });

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

    it('does NOT treat a dominant lead share as HVAC=236220 identity', () => {
      const f = buildMarketFilter({ coverage: hvac({ leadCodePct: 0.556, topCodePct: 0.556 }) })!;
      expect(f.mode).toBe('keyword');
      expect(f.naics_codes).toBeUndefined();
      expect(f.keywords).toContain('hvac');
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

/**
 * THE SCOPE LEAK (Eric, 2026-08-15 — hypersonics report) plus the BQ identity split
 * (2026-09-20). leadCodePct may describe where description-matched dollars landed.
 * It must never decide that the user's market IS that NAICS.
 */
describe('coverage lead share is not market identity (BQ work-text)', () => {
  it('HVAC at 52% 236220 stays keyword-ranked', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'hvac',
      allNaics: [{ code: '236220', name: 'Commercial and Institutional Building Construction', amount: 655_000_000, pct: 0.52 }],
      leadCodePct: 0.52, topCodePct: 0.52, topPsc: null, topPscPct: 0,
    }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.naics_codes).toBeUndefined();
    expect(f.keywords).toContain('hvac');
  });

  it('drones at 64% 336411 stays keyword-ranked', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'drones',
      allNaics: [{ code: '336411', name: 'Aircraft Manufacturing', amount: 57_600_000, pct: 0.64 }],
      leadCodePct: 0.64, topCodePct: 0.64, topPsc: null, topPscPct: 0,
    }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.naics_codes).toBeUndefined();
  });

  it('patrol at 78.6% 336611 stays keyword-ranked (shipbuilding was measured, not identity)', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'patrol',
      allNaics: [{ code: '336611', name: 'Ship Building and Repairing', amount: 709_000_000, pct: 0.786 }],
      leadCodePct: 0.786, topCodePct: 0.786, topPsc: null, topPscPct: 0,
    }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.naics_codes).toBeUndefined();
    expect(f.keywords).toEqual(['patrol']);
  });

  it('hypersonic with a curated expansion still ranks by expanded keywords, not ammunition NAICS', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'hypersonic',
      allNaics: [{ code: '332993', name: 'Ammunition Manufacturing', amount: 325_138_747, pct: 0.598 }],
      leadCodePct: 0.598, topCodePct: 0.598, topPsc: null, topPscPct: 0,
    }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.naics_codes).toBeUndefined();
    expect(f.keywords).toContain('hypersonic');
    expect(f.keywords).toContain('scramjet');
    expect(f.keywords!.length).toBeGreaterThan(1);
  });

  it('a concentrated keyword with no expansion keeps the keyword and does not pin NAICS', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'widget fabrication',
      allNaics: [{ code: '332993', name: 'Ammunition Manufacturing', amount: 1, pct: 0.598 }],
      leadCodePct: 0.598, topCodePct: 0.598, topPsc: null, topPscPct: 0,
    }) })!;
    const out = marketFilterToUsaspending(f, { award_type_codes: ['A'] });
    expect(out.keywords).toEqual(['widget fabrication']);
    expect(out.naics_codes).toBeUndefined();
    expect(out.award_type_codes).toEqual(['A']);
  });

  it('still ranks by keyword when there is no lead NAICS row', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'hypersonic', allNaics: [], leadCodePct: 0.9, topCodePct: 0.9, topPsc: null, topPscPct: 0,
    }) });
    expect(f).not.toBeNull();
    expect(f!.mode).toBe('keyword');
    expect(f!.keywords).toContain('hypersonic');
  });

  it('does NOT override the term-of-art PSC pin (FM-10 still wins)', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'explosive ordnance disposal',
      pinnedPscCodes: ['1385', '1386'],
      leadCodePct: 0.62,
    }) })!;
    expect(f.mode).toBe('keyword_psc');
    expect(f.naics_codes).toBeUndefined();
  });
});
