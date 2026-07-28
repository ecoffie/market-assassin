/**
 * Terms-of-art keyword expansion (Eric 2026-07-28 real-run feedback). USASpending keyword search is
 * exact-phrase, so an acronym term under-counts its own market: "drones" → ~$243M (missed UAS/UAV/
 * unmanned aircraft), and "explosive ordnance disposal" collapsed to "explosive" → the $2.7B
 * ammunition-MFG market (the OPPOSITE of a firm that makes EOD tools). termOfArtSynonyms() returns the
 * OR-array of real aliases so keywordCoverage measures the market a domain expert actually means.
 */
import { describe, it, expect } from 'vitest';
import { termOfArtSynonyms, TERM_OF_ART_EXPANSIONS } from './sector-expansions';

describe('termOfArtSynonyms — acronym/synonym market expansion', () => {
  it('drones → UAS / UAV / unmanned aircraft aliases', () => {
    const a = termOfArtSynonyms('drones');
    expect(a).toBeTruthy();
    expect(a).toContain('UAS');
    expect(a).toContain('UAV');
    expect(a).toContain('unmanned aircraft');
  });

  it('matches the many spellings a user might type for unmanned aircraft', () => {
    for (const kw of ['drone', 'UAV', 'sUAS', 'unmanned aerial system', 'unmanned aircraft systems']) {
      expect(termOfArtSynonyms(kw), kw).toBeTruthy();
    }
  });

  it('explosive ordnance disposal → EOD aliases, NOT bulk explosives', () => {
    const a = termOfArtSynonyms('explosive ordnance disposal');
    expect(a).toBeTruthy();
    expect(a).toContain('explosive ordnance disposal');
    expect(a).toContain('EOD');
    // the whole point: it must NOT reduce to the "explosive" (bulk-explosives) market.
    expect(a).not.toContain('explosive');
    expect(a).not.toContain('bulk explosives');
  });

  it('the bare acronym "EOD" also expands (award text uses the acronym)', () => {
    expect(termOfArtSynonyms('EOD')).toContain('EOD');
  });

  it('counter-UAS is a DISTINCT term from UAS', () => {
    const cuas = termOfArtSynonyms('counter-drone');
    expect(cuas).toBeTruthy();
    expect(cuas).toContain('counter-UAS');
  });

  it('an ordinary keyword (no acronym gap) returns null — vocab/phrase-reduction handles it', () => {
    expect(termOfArtSynonyms('janitorial')).toBeNull();
    expect(termOfArtSynonyms('construction')).toBeNull();
    expect(termOfArtSynonyms('roofing')).toBeNull();
  });

  it('every expansion entry lists at least 2 aliases (an OR of one is pointless)', () => {
    for (const e of TERM_OF_ART_EXPANSIONS) {
      expect(e.keywords.length, e.match.source).toBeGreaterThanOrEqual(2);
    }
  });
});
