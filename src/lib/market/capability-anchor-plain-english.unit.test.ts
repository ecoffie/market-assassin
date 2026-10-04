/**
 * Plain-English candidate rules (ChatGPT blocker #3, 2026-10-04). Each rule is pinned by the
 * case that motivated it. These helpers only REARRANGE the company's own words.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanAnchorCandidate,
  decomposeAnchorPhrase,
  firmTypePhrases,
  isGroundedInSource,
  rankAnchorCandidates,
  scoreAnchorPhrase,
} from './capability-anchor';
import { chooseProbePhrases, selectAnchorFromProbes, MIN_USABLE_MARKET_USD } from '@/mcp/tools/capability-market-match';
import type { KeywordCoverage } from './keyword-coverage';

describe('cleanAnchorCandidate — who you are is not what you do', () => {
  it.each([
    ['small engineering', 'engineering'],
    ['does building automation', 'building automation'],
    ['20-person', null],
    ['family-owned commercial roofing', 'commercial roofing'],
    ['document-translation services', 'document translation services'],
    ['drone-based lidar surveying', 'lidar surveying'],
    ['waterproofing contractor', 'waterproofing'],
  ])('%s → %s', (input, expected) => {
    expect(cleanAnchorCandidate(input)).toBe(expected);
  });
});

describe('decomposeAnchorPhrase — only the ACTIVITY side, one activity per part', () => {
  it('"automation and energy audits" splits into its activities', () => {
    expect(decomposeAnchorPhrase('building automation and energy audits')).toEqual(expect.arrayContaining(['building automation', 'energy audits']));
  });
  it('words after for/with/in are the customer, equipment or place — dropped', () => {
    expect(decomposeAnchorPhrase('photogrammetry for infrastructure inspection')).not.toContain('infrastructure');
    expect(decomposeAnchorPhrase('haul freight with a fleet of tractor-trailers')).not.toContain('tractor');
    expect(decomposeAnchorPhrase('roofing contractor in florida')).not.toContain('florida');
  });
  it('the head noun skips trailing service-line and deliverable nouns', () => {
    expect(decomposeAnchorPhrase('translation services')).toContain('translation');
    expect(decomposeAnchorPhrase('environmental consulting')).toContain('environmental');
    expect(decomposeAnchorPhrase('print marketing materials')).not.toContain('materials');
  });
  it('evaluative adjectives never become candidates', () => {
    expect(decomposeAnchorPhrase('achieve better outcomes')).not.toContain('better');
  });
});

describe('source grounding replaces the global roofing ban', () => {
  it('a roofing contractor may anchor on roofing (the ban rejected every one)', () => {
    expect(scoreAnchorPhrase('commercial roofing', new Set()).score).toBeGreaterThanOrEqual(0);
    const ranked = rankAnchorCandidates(['commercial roofing'], { sourceText: 'Family-owned commercial roofing and waterproofing contractor in Florida.' });
    expect(ranked.find((r) => r.phrase === 'commercial roofing')?.score).toBeGreaterThanOrEqual(0);
  });
  it('Morris (concrete) never anchors on roofing: the word is not in its text', () => {
    const morris = 'We provide services that include concrete reinforcement, concrete placement and finishing, forming, drywall, metal studs.';
    expect(isGroundedInSource('roofing', morris)).toBe(false);
    const roofing = rankAnchorCandidates(['roofing', 'asphalt roofing'], { sourceText: morris }).filter((r) => /roofing|asphalt/.test(r.phrase));
    expect(roofing.length).toBeGreaterThan(0);
    expect(roofing.every((r) => r.score < 0 && r.rejectReason === 'not_in_source')).toBe(true);
  });
  it('a fragment from the object side is rejected even when the keyword list hands it over', () => {
    const d = 'We haul freight with a fleet of tractor-trailers.';
    expect(rankAnchorCandidates(['tractor-trailers'], { sourceText: d }).find((r) => r.phrase === 'tractor trailers')?.rejectReason).toBe('not_in_source');
  });
});

describe('firm-type phrases are tried last, never preferred', () => {
  it('"small engineering firm" → engineering is a firm type; a staffing AGENCY is not demoted', () => {
    expect(firmTypePhrases('Small engineering firm doing environmental remediation.').has('engineering')).toBe(true);
    expect(firmTypePhrases('Medical staffing agency placing nurses.').size).toBe(0);
  });
});

describe('probe choice + selection ladder', () => {
  const cov = (totalMarket: number): KeywordCoverage => ({ totalMarket, naicsCount: 1, allNaics: [{ code: '562910', name: 'x', amount: totalMarket, pct: 1 }] } as unknown as KeywordCoverage);

  it('reserves slots for derived fallbacks after the extractor phrases', () => {
    const ranked = [
      { phrase: 'a b', score: 50, kind: 'phrase' as const, origin: 'extracted' as const },
      ...Array.from({ length: 10 }, (_, i) => ({ phrase: `d${i} x`, score: 10, kind: 'phrase' as const, origin: 'derived' as const })),
    ];
    const chosen = chooseProbePhrases(ranked);
    expect(chosen[0]).toBe('a b');
    expect(chosen.filter((p) => p.startsWith('d')).length).toBe(6);
  });

  it('rank order wins among usable markets; dollars only admit', () => {
    const pick = selectAnchorFromProbes([
      { phrase: 'cybersecurity assessments', coverage: cov(2_000_000), failed: false },
      { phrase: 'cybersecurity', coverage: cov(1_400_000_000), failed: false },
      { phrase: 'fedramp', coverage: cov(9_000_000_000), failed: false },
    ]);
    expect(pick?.probe.phrase).toBe('cybersecurity');
    expect(pick?.tier).toBe('usable');
  });

  it('falls back to a thin market, then to nothing', () => {
    expect(selectAnchorFromProbes([{ phrase: 'x', coverage: cov(MIN_USABLE_MARKET_USD - 1), failed: false }])?.tier).toBe('thin');
    expect(selectAnchorFromProbes([{ phrase: 'x', coverage: cov(100_000), failed: false }, { phrase: 'y', coverage: null, failed: false }])).toBeNull();
  });
});
