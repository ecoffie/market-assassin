/**
 * Terms-of-art keyword expansion (Eric 2026-07-28 real-run feedback). USASpending keyword search is
 * exact-phrase, so an acronym term under-counts its own market: "drones" → ~$243M (missed UAS/UAV/
 * unmanned aircraft), and "explosive ordnance disposal" collapsed to "explosive" → the $2.7B
 * ammunition-MFG market (the OPPOSITE of a firm that makes EOD tools). termOfArtSynonyms() returns the
 * OR-array of real aliases so keywordCoverage measures the market a domain expert actually means.
 */
import { describe, it, expect } from 'vitest';
import { termOfArtSynonyms, termOfArtPscCodes, termOfArtNaicsCodes, TERM_OF_ART_EXPANSIONS } from './sector-expansions';

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

describe('termOfArtPscCodes — PSC pinning for keyword-polluted terms', () => {
  it('EOD pins to PSC 1385 (surface) + 1386 (underwater) — the real EOD-tools market', () => {
    // The keyword "explosive ordnance disposal" matches the ammunition MANUFACTURERS (top PSC 1376
    // BULK EXPLOSIVES $1.2B), so we pin to the authoritative EOD-equipment PSCs instead. Verified
    // live 2026-07-28: 1385 = $173M, 1386 = $39M (real EOD tools) vs the keyword's misleading $2.81B.
    const psc = termOfArtPscCodes('explosive ordnance disposal');
    expect(psc).toEqual(['1385', '1386']);
    expect(termOfArtPscCodes('EOD')).toEqual(['1385', '1386']);
  });
  it('drones is NOT PSC-pinned (its keyword expansion works cleanly)', () => {
    // UAS/UAV keywords are un-polluted, so drones stays keyword-based ($243M → $3.9B via synonyms).
    expect(termOfArtPscCodes('drones')).toBeNull();
  });
  it('ordinary keywords have no PSC pin', () => {
    expect(termOfArtPscCodes('janitorial')).toBeNull();
    expect(termOfArtPscCodes('construction')).toBeNull();
  });
  it('EOD codes are verified-real, not guessed (exactly 1385/1386, no filler)', () => {
    const psc = termOfArtPscCodes('render safe')!;
    expect(psc).toContain('1385');
    expect(psc).toContain('1386');
    expect(psc).not.toContain('1670'); // parachutes — a false friend, correctly excluded
    expect(psc).not.toContain('1376'); // bulk explosives — the polluted code we're AVOIDING
  });
});

describe('termOfArtNaicsCodes — CURATED industry codes for name-search datasets (recompete/contacts)', () => {
  it('drones → the UAS-manufacturing CORE, NOT the noisy full-coverage tail', () => {
    const n = termOfArtNaicsCodes('drones')!;
    expect(n).toContain('336411'); // Aircraft Manufacturing
    expect(n).toContain('336413'); // Aircraft Parts
    // the tail codes that keywordCoverage carries but would surface unrelated recompetes are EXCLUDED:
    expect(n).not.toContain('541110'); // Offices of Lawyers
    expect(n).not.toContain('561210'); // Facilities Support (drones' tail)
    expect(n.length).toBeLessThanOrEqual(4); // tight, not the ~14-code coverage set
  });
  it('EOD → the verified EOD-equipment performers', () => {
    const n = termOfArtNaicsCodes('explosive ordnance disposal')!;
    expect(n).toContain('561210'); // EOD support ops
    expect(n).toContain('334511'); // detection/render-safe
    expect(n).toContain('336992'); // EOD robots/vehicles
  });
  it('ordinary keywords have no curated NAICS', () => {
    expect(termOfArtNaicsCodes('janitorial')).toBeNull();
  });
});
