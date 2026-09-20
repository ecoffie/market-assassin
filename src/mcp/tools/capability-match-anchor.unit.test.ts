/**
 * capability_market_match capability-anchoring (FM-U10, Eric/QA 2026-07-29;
 * identity decouple 2026-09-20).
 *
 * Original symptom: for a HARDWARE maker (EOD tools) the lead NAICS resolved to 561210 Facilities
 * Support (67% by $ — base-ops contracts that merely MENTION EOD), dragging vocabulary and competitors
 * to LOGCAP/KBR.
 *
 * Completing that fix: coverage NAICS share is measurement, not identity. Lead NAICS is proposed
 * only from SAM/award evidence overlapping the measured distribution. When coverage is PSC-pinned,
 * (a) source COMPETITORS from the actual recipients of the pinned PSC (topRecipientsByPsc), and
 * (b) when the PSC vocab table is empty, fall back buyer_vocabulary to curated term-of-art terms
 * + official PSC titles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'capability-market-match.ts'), 'utf8');

describe('FM-U10 source assertions', () => {
  it('does not pick lead NAICS from coverage dollar-share (including generic-services skip)', () => {
    expect(src).not.toContain('GENERIC_SERVICES');
    expect(src).toContain('resolveLeadNaicsWithEvidence(coverage, evidence, null)');
    expect(src).not.toContain('pickLeadNaicsFromCoverage');
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

describe('lead-NAICS anchoring logic (mirror)', () => {
  const pickLead = (
    allNaics: Array<{ code: string }>,
    evidenceNaics: string[],
  ): string | null => {
    for (const code of evidenceNaics) {
      const hit = allNaics.find(
        (n) => n.code === code || n.code.slice(0, 3) === code.slice(0, 3),
      );
      if (hit) return hit.code;
    }
    return null;
  };
  it('does not treat the coverage dollar-lead as identity when evidence is empty', () => {
    const naics = [{ code: '561210' }, { code: '334511' }, { code: '336992' }];
    expect(pickLead(naics, [])).toBeNull();
  });
  it('proposes a NAICS only when SAM/award evidence overlaps the measured set', () => {
    const naics = [{ code: '561210' }, { code: '334511' }, { code: '336992' }];
    expect(pickLead(naics, ['334511'])).toBe('334511');
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
