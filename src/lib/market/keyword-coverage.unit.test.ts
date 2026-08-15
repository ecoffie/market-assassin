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

  it('DOMINANT-NAICS: a keyword concentrated in one code ranks by that code, KEEPING the keyword', () => {
    // "commercial & institutional building construction" → the lead is the majority
    // (>=40%) → rank by the code, so the airfield PSC can't win (NASA-over-DOD fix).
    //
    // Updated 2026-08-15: this used to assert null, which ALSO dropped the keyword and
    // widened every section to the whole NAICS (the hypersonics leak). The ranking
    // intent is preserved — mode is keyword_naics and the code is pinned — but the
    // market stays inside the keyword.
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'commercial and institutional building construction',
      topCodePct: 0.68,
      leadCodePct: 0.68, // the lead IS 236220 here — keyword and dominant code agree
      topPsc: { code: 'Y1BZ', name: 'Construction of Other Airfield Structures' },
      topPscPct: 0.45,
    }) });
    expect(f).not.toBeNull();
    expect(f!.mode).toBe('keyword_naics');
    // Crucially NOT ranked by the airfield PSC — that was the original bug.
    expect(f!.psc_codes).toBeUndefined();
    expect(f!.naics_codes).toEqual(['336411']);
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
    it('no pin → dominant lead ranks by NAICS (keyword_naics), NOT the PSC pin path', () => {
      // Was toBeNull() before the scope-leak fix; null dropped the keyword and
      // widened the market to the whole NAICS. Ranking by the code is preserved.
      // The drones fixture HAS a curated expansion, so a dominant lead scopes by the
      // expanded keywords rather than pinning the code. Either way it is NOT the
      // PSC-pin path, and the keyword is never dropped — the point of this test.
      const f = buildMarketFilter({ coverage: coverage({ pinnedPscCodes: null, leadCodePct: 0.62 }) })!;
      expect(f.mode).toBe('keyword');
      expect(f.psc_codes).toBeUndefined();
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

    it('fires the gate when the LEAD itself is dominant', () => {
      // Gate still FIRES on the lead (not the biggest) — it now expresses that as
      // keyword_naics rather than null, so hvac stays scoped to hvac.
      const f = buildMarketFilter({ coverage: hvac({ leadCodePct: 0.556 }) })!;
      expect(f.mode).toBe('keyword_naics');
      expect(f.keywords).toEqual(['hvac']);
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
 * THE SCOPE LEAK (Eric, 2026-08-15 — hypersonics report).
 *
 * The dominant-NAICS gate used to `return null`, which callers read as "no market
 * filter" — dropping the KEYWORD entirely, so agencies/contractors/recompetes and the
 * headline all silently measured the WHOLE NAICS.
 *
 * Measured on "hypersonic": leadCodePct 59.8% (332993 Ammunition Mfg) tripped the gate.
 * A $543M keyword market was reported against a $26.2B top-10 agency table, with the
 * Army (ammunition) shown as top buyer instead of the Air Force. Ranking basis and
 * SCOPE are different decisions: leadCodePct may choose the former, never the latter.
 */
describe('dominant-NAICS gate keeps the keyword in scope (the hypersonics leak)', () => {
  it('a dominant keyword WITHOUT a curated expansion pins the lead code', () => {
    // No TERM_OF_ART entry for this term → keyword AND the code (never null).
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'widget fabrication',
      allNaics: [{ code: '332993', name: 'Ammunition Manufacturing', amount: 325_138_747, pct: 0.598 }],
      leadCodePct: 0.598, topCodePct: 0.598, topPsc: null, topPscPct: 0,
    }) });
    expect(f).not.toBeNull();
    expect(f!.mode).toBe('keyword_naics');
    expect(f!.keywords).toEqual(['widget fabrication']);
    expect(f!.naics_codes).toEqual(['332993']);
  });

  it('a dominant keyword WITH a curated expansion scopes by the expanded terms, not the code', () => {
    // Hypersonics spans codes by definition — scramjet propulsion and boost-glide
    // bodies are not bought under the ammunition code that dominates the literal word.
    // Pinning it would AND away the expansion (measured: $953M / Air Force only vs
    // $1.75B across Air Force / Navy / MDA / DARPA).
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'hypersonic',
      allNaics: [{ code: '332993', name: 'Ammunition Manufacturing', amount: 325_138_747, pct: 0.598 }],
      leadCodePct: 0.598, topCodePct: 0.598, topPsc: null, topPscPct: 0,
    }) })!;
    expect(f.mode).toBe('keyword');
    expect(f.naics_codes).toBeUndefined();          // NOT pinned — that was the bug
    expect(f.keywords).toContain('hypersonic');
    expect(f.keywords).toContain('scramjet');
    expect(f.keywords!.length).toBeGreaterThan(1);
  });

  it('carries BOTH constraints into the USASpending filter when the code IS pinned', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'widget fabrication',
      allNaics: [{ code: '332993', name: 'Ammunition Manufacturing', amount: 1, pct: 0.598 }],
      leadCodePct: 0.598, topCodePct: 0.598, topPsc: null, topPscPct: 0,
    }) })!;
    const out = marketFilterToUsaspending(f, { award_type_codes: ['A'] });
    expect(out.keywords).toEqual(['widget fabrication']);
    expect(out.naics_codes).toEqual(['332993']);
    expect(out.award_type_codes).toEqual(['A']); // base preserved
  });

  it('still falls back to null when there is no lead code to pin', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'hypersonic', allNaics: [], leadCodePct: 0.9, topCodePct: 0.9, topPsc: null, topPscPct: 0,
    }) });
    expect(f).toBeNull();
  });

  it('does NOT change a cross-cutting keyword below the threshold', () => {
    // drones: lead 28% < 40% → plain keyword ranking, exactly as before.
    const f = buildMarketFilter({ coverage: coverage() });
    expect(f!.mode).not.toBe('keyword_naics');
    expect(f!.naics_codes).toBeUndefined();
  });

  it('does NOT override the term-of-art PSC pin (FM-10 still wins)', () => {
    const f = buildMarketFilter({ coverage: coverage({
      keyword: 'explosive ordnance disposal',
      pinnedPscCodes: ['1385', '1386'],
      leadCodePct: 0.62, // dominant, but the pin is checked first
    }) })!;
    expect(f.mode).toBe('keyword_psc');
    expect(f.naics_codes).toBeUndefined();
  });
});
