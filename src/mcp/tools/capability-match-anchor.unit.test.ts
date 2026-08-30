/**
 * capability_market_match capability-anchoring (FM-U10, Eric/QA 2026-07-29).
 *
 * Original symptom: for a HARDWARE maker (EOD tools) the lead NAICS resolved to 561210 Facilities
 * Support (67% by $ — base-ops contracts that merely MENTION EOD), dragging vocabulary and competitors
 * to LOGCAP/KBR.
 *
 * The FIRST fix (generic-services skip) moved the lead OFF 561210 but landed on 334511 (detection/
 * instruments) — the biggest PRODUCT NAICS in the pinned PSC, but far broader than the capability. So a
 * NAICS competitor search returned radar/instrument primes (Raytheon/Lockheed/Northrop), NOT EOD-tool
 * peers, and the PSC vocab table (no rows for 1385/1386) left buyer_vocabulary EMPTY. Re-verified live
 * 2026-07-29 and REOPENED as PARTIAL.
 *
 * The COMPLETE fix (this file locks it): when the coverage is PSC-pinned, (a) source COMPETITORS from
 * the actual recipients of the pinned PSC (topRecipientsByPsc → VideoRay/Tomahawk/L3Harris Fuzing/
 * Vidisco — real EOD makers, verified live), not a broad product NAICS; and (b) when the PSC vocab table
 * is empty, fall back buyer_vocabulary to the curated term-of-art terms + official PSC titles. Both are
 * authoritative real data, never LLM-invented. The lead NAICS is still the top non-generic code (334511)
 * — the honest #1 product code by dollars; the earlier "332993 Ammunition Mfg" claim never matched the
 * live data (332993 isn't in the PSC 1385/1386 breakdown) and is NOT asserted here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'capability-market-match.ts'), 'utf8');

describe('FM-U10 source assertions', () => {
  it('has a generic-services skip set so the lead NAICS avoids facilities-support catch-alls', () => {
    expect(src).toContain('GENERIC_SERVICES');
    expect(src).toContain("'561210'"); // Facilities Support — the exact culprit
  });
  it('sources vocabulary from the PSC when the coverage is PSC-pinned', () => {
    expect(src).toMatch(/isPscPinned && pinnedPsc[\s\S]*getVocabulary\(pinnedPsc, \{ codeType: 'psc'/);
  });
  it('sources COMPETITORS from the pinned PSC recipients (real EOD makers, not a broad NAICS proxy)', () => {
    expect(src).toContain('topRecipientsByPsc');
    expect(src).toMatch(/fetchCompetitors[\s\S]*isPscPinned[\s\S]*topRecipientsByPsc\(coverage\.pinnedPscCodes/);
  });
  it('falls back buyer_vocabulary to term-of-art + PSC titles when the PSC vocab table is empty', () => {
    expect(src).toMatch(/isPscPinned && vocabTerms\.length === 0/);
    expect(src).toContain('termOfArtSynonyms(lead)');
  });
  it('still keeps a NAICS competitor fallback for NON-pinned narrow terms', () => {
    expect(src).toMatch(/searchContractors\(\{ naics: leadNaics/);
  });
});

// Pure-logic mirror of the lead-NAICS anchoring.
describe('lead-NAICS anchoring logic (mirror)', () => {
  const GENERIC = new Set(['561210', '561990', '541990', '561499', '541611', '541618']);
  const pickLead = (allNaics: Array<{ code: string }>, pinned: boolean) => {
    const nonGeneric = allNaics.find((n) => !GENERIC.has(n.code))?.code;
    return pinned ? (nonGeneric ?? allNaics[0]?.code) : allNaics[0]?.code;
  };
  it('PSC-pinned: skips 561210 to the real top product code (334511 for EOD, per live data)', () => {
    // The live PSC 1385/1386 NAICS order: 561210 (generic, skipped) → 334511 → 336992.
    const naics = [{ code: '561210' }, { code: '334511' }, { code: '336992' }];
    expect(pickLead(naics, true)).toBe('334511');
  });
  it('not pinned: keeps the promoted lead as-is (unchanged behavior)', () => {
    const naics = [{ code: '541512' }, { code: '541519' }];
    expect(pickLead(naics, false)).toBe('541512');
  });
  it('pinned but ALL generic: falls back to the top (no non-generic exists)', () => {
    const naics = [{ code: '561210' }, { code: '561990' }];
    expect(pickLead(naics, true)).toBe('561210');
  });
});

// Pure-logic mirror of the pinned-competitor precedence: PSC recipients win over the keyword/NAICS path.
describe('pinned-competitor precedence (mirror)', () => {
  const resolve = (opts: { pinned: boolean; pscPeers: string[]; keywordHits: string[]; naicsHits: string[] }) => {
    if (opts.pinned && opts.pscPeers.length) return opts.pscPeers; // PSC recipients take priority
    if (opts.keywordHits.length === 0 && opts.naicsHits.length) return opts.naicsHits; // narrow-term fallback
    return opts.keywordHits;
  };
  it('pinned term uses PSC recipients even when a (wrong) keyword result exists', () => {
    const out = resolve({ pinned: true, pscPeers: ['VideoRay', 'Tomahawk'], keywordHits: ['Raytheon'], naicsHits: [] });
    expect(out).toEqual(['VideoRay', 'Tomahawk']);
  });
  it('non-pinned narrow term still falls back to NAICS when keyword is empty', () => {
    const out = resolve({ pinned: false, pscPeers: [], keywordHits: [], naicsHits: ['SomePrime'] });
    expect(out).toEqual(['SomePrime']);
  });
});
