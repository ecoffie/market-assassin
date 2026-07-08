import { describe, it, expect } from 'vitest';
import {
  keywordCandidates,
  isDistinctiveKeyword,
  isSearchableKeyword,
  sanitizeKeywords,
} from './keyword-sanitize';

/**
 * Locks the phrase→candidate reducer that grounds keywords against USASpending.
 * The regression this guards: "video production" was reduced to the GENERIC word
 * "production" (a $36B defense-mfg wildcard) instead of the DISTINCTIVE "video",
 * because the fallback ranked words LONGEST-first. That grounded a video company
 * onto engineering/R&D codes (Candice / Whitty-CAP, Jul 8 2026). Candidates must
 * order by distinctiveness, and generic words must never precede distinctive ones.
 */

describe('keywordCandidates — distinctive words come before generic ones', () => {
  it('THE REGRESSION: "video production" yields "video" before "production"', () => {
    const c = keywordCandidates('video production');
    expect(c[0]).toBe('video production');           // full phrase always first
    expect(c.indexOf('video')).toBeLessThan(c.indexOf('production'));
  });

  it('does not drop the distinctive word entirely', () => {
    expect(keywordCandidates('video production')).toContain('video');
  });

  it('still reduces "demolition services" to "demolition" (no regression on the win case)', () => {
    // "services" is a stopword; "demolition" is the only meaningful word.
    expect(keywordCandidates('demolition services')).toEqual(['demolition services', 'demolition']);
  });

  it('keeps the distinctive term for "cybersecurity consulting" and drops generic "consulting"', () => {
    const c = keywordCandidates('cybersecurity consulting');
    expect(c).toContain('cybersecurity');
    expect(c).not.toContain('consulting'); // consulting is generic/stopword noise
  });

  it('orders both generic words after any distinctive one but keeps them as fallbacks', () => {
    // "program management" — both words are generic; phrase first, then the words.
    const c = keywordCandidates('program management');
    expect(c[0]).toBe('program management');
    expect(c).toContain('management');
    expect(c).toContain('program');
  });

  it('strips geography (place of performance is not a capability)', () => {
    expect(keywordCandidates('construction florida')).not.toContain('florida');
  });

  it('returns [] for empty/whitespace input', () => {
    expect(keywordCandidates('')).toEqual([]);
    expect(keywordCandidates('   ')).toEqual([]);
  });

  it('caps the candidate list', () => {
    expect(keywordCandidates('alpha bravo charlie delta echo foxtrot', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('isDistinctiveKeyword — generic federal wildcards are NOT distinctive', () => {
  it('"production" is generic (the bug root cause)', () => {
    expect(isDistinctiveKeyword('production')).toBe(false);
  });

  it('"management" / "consulting" are generic', () => {
    expect(isDistinctiveKeyword('management')).toBe(false);
    expect(isDistinctiveKeyword('consulting')).toBe(false);
  });

  it('"video" / "demolition" / "cybersecurity" are distinctive', () => {
    expect(isDistinctiveKeyword('video')).toBe(true);
    expect(isDistinctiveKeyword('demolition')).toBe(true);
    expect(isDistinctiveKeyword('cybersecurity')).toBe(true);
  });

  it('any multi-word phrase is distinctive', () => {
    expect(isDistinctiveKeyword('program management')).toBe(true);
    expect(isDistinctiveKeyword('video production')).toBe(true);
  });
});

describe('sanitize/searchable sanity', () => {
  it('drops stopwords and short noise, keeps real terms', () => {
    expect(isSearchableKeyword('the')).toBe(false);
    expect(isSearchableKeyword('ota')).toBe(false);     // ambiguous 3-char substring
    expect(isSearchableKeyword('video')).toBe(true);
    expect(sanitizeKeywords(['video production', 'the', '  ', 'video production'])).toEqual(['video production']);
  });
});
