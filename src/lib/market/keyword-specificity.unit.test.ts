/**
 * SPECIFICITY RANKING — a capability word must outrank a generic high-dollar one.
 *
 * MEASURED 2026-08-25: "commercial roofing and building envelope repair" returned
 * **336611 SHIP BUILDING AND REPAIRING** as its top suggestion, at "high" confidence.
 *
 * Two causes, both fixed here:
 *   1. "building" was absent from GENERIC_SINGLE_WORDS, so it read as distinctive
 *      despite being a federal wildcard exactly like "construction" and "facility".
 *   2. Among equally-distinctive words the tiebreak was LENGTH, so "building" (8)
 *      beat "roofing" (7). The module doc already warned "longest ≈ most specific" is
 *      backwards — it survived as the tiebreak anyway.
 *
 * Dollars are now a TIE-BREAKER, never the primary signal: the bare term "roofing"
 * always resolved 238160 correctly; the generic sibling was simply stealing the match.
 */
import { describe, it, expect } from 'vitest';
import { keywordCandidates, isDistinctiveKeyword } from './keyword-sanitize';

/** The first candidate the route would actually query after the full phrase. */
const firstWord = (desc: string) => keywordCandidates(desc).find((c) => !c.includes(' '));

describe('⚠️ THE REGRESSION — roofing vs ship building', () => {
  it('ranks the TRADE ("roofing") above the generic object ("building")', () => {
    expect(firstWord('commercial roofing and building envelope repair')).toBe('roofing');
  });

  it('"building" is generic — a federal wildcard, not a capability', () => {
    expect(isDistinctiveKeyword('building')).toBe(false);
    expect(isDistinctiveKeyword('buildings')).toBe(false);
  });

  it('"roofing" is distinctive', () => {
    expect(isDistinctiveKeyword('roofing')).toBe(true);
  });

  it('the generic sibling never precedes the trade in the candidate list', () => {
    const c = keywordCandidates('commercial roofing and building envelope repair');
    expect(c.indexOf('roofing')).toBeLessThan(c.indexOf('building') === -1 ? Infinity : c.indexOf('building'));
  });
});

describe('length is no longer the tiebreak', () => {
  it('a SHORTER trade word beats a LONGER generic one', () => {
    // "roofing" (7) vs "building" (8) — the exact inversion that caused the bug.
    expect(firstWord('roofing and building work')).toBe('roofing');
  });

  it('user word ORDER breaks ties among equally distinctive words', () => {
    // People lead with what they do, so earlier ≈ more central.
    expect(firstWord('janitorial and custodial services')).toBe('janitorial');
    expect(firstWord('custodial and janitorial services')).toBe('custodial');
  });
});

describe('does not regress the fixes that came before it', () => {
  it('video production still leads with "video", not the $36B wildcard "production"', () => {
    expect(firstWord('video production company')).toBe('video');
  });

  it('cybersecurity still beats "engineering"', () => {
    expect(firstWord('cybersecurity and cloud engineering')).toBe('cybersecurity');
  });

  it('the FULL PHRASE is still tried first (USASpending is exact-phrase)', () => {
    expect(keywordCandidates('commercial roofing and building envelope repair')[0])
      .toBe('commercial roofing and building envelope repair');
  });
});

describe('the newly-generic words are the right ones', () => {
  it.each(['building', 'buildings', 'envelope', 'commercial', 'federal', 'government'])(
    '%s is treated as generic', (w) => {
      expect(isDistinctiveKeyword(w)).toBe(false);
    });

  it('real trades stay distinctive', () => {
    for (const w of ['roofing', 'janitorial', 'custodial', 'cybersecurity', 'welding', 'dredging']) {
      expect(isDistinctiveKeyword(w)).toBe(true);
    }
  });
});
