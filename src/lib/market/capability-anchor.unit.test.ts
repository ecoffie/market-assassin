/**
 * Capability anchor ranking — Morehouse Ascend failure patterns + grounding semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  pickBestAnchor,
  rankAnchorCandidates,
  scoreAnchorPhrase,
  validateMarketAnchor,
  extractCapabilityTail,
  buildBrandTokenSet,
  evaluateTamSanity,
  emptyAnchorEvidence,
} from '@/lib/market/capability-anchor';
import type { AnchorEvidence } from '@/lib/market/capability-anchor';

/**
 * Evidence defaults to identity `none`, which is what an unresolved company looks like.
 * A test that wants corroboration has to say WHOSE registration it is — that is the gate.
 * `SYNTH0STB001` is a documented synthetic 12-character UEI (isWellFormedUei), not a SAM row.
 */
const ev = (over: Partial<AnchorEvidence> = {}): AnchorEvidence => ({ ...emptyAnchorEvidence(), ...over });
const resolved = (over: Partial<AnchorEvidence> = {}): AnchorEvidence =>
  ev({ identity: 'unique', identityUei: 'SYNTH0STB001', identityCandidates: 1, ...over });

describe('brand stripping — explicit cases', () => {
  it('BMA: rejects acronym, keeps capability phrase', () => {
    const brand = 'Business Management Associates, Inc';
    expect(scoreAnchorPhrase('bma', buildBrandTokenSet({ clientName: brand })).score).toBeLessThan(0);
    const best = pickBestAnchor(
      ['bma', 'program management', 'acquisition support', 'human capital strategy'],
      { clientName: brand },
    );
    expect(best?.phrase.toLowerCase()).not.toBe('bma');
    expect(best?.phrase.toLowerCase()).toMatch(/program|management|acquisition|human/);
  });

  it('IMRI: strips brand and verb wrapper, keeps cybersecurity noun', () => {
    const brand = 'Information Management Resources, Inc.';
    expect(extractCapabilityTail('provides cybersecurity')).toBe('cybersecurity');
    const best = pickBestAnchor(['imri', 'provides cybersecurity', 'cybersecurity risk management'], {
      clientName: brand,
    });
    expect(best?.phrase.toLowerCase()).toMatch(/cybersecurity/);
    expect(best?.phrase.toLowerCase()).not.toMatch(/^provides\b/);
    expect(best?.phrase.toLowerCase()).not.toBe('imri');
  });

  it('SRFed: rejects compact domain acronym', () => {
    const brand = 'South River Federal Solutions LLC';
    const best = pickBestAnchor(['srfed', 'medical staffing', 'it staffing'], { clientName: brand });
    expect(best?.phrase.toLowerCase()).not.toBe('srfed');
    expect(best?.phrase.toLowerCase()).toMatch(/staffing|medical|it/);
  });

  it('punctuation/suffix variants strip from brand token set', () => {
    const tokens = buildBrandTokenSet({ clientName: 'OVP Management Consulting Group, Inc.' });
    expect(tokens.has('ovp')).toBe(true);
    expect(tokens.has('inc')).toBe(false);
    expect(tokens.has('group')).toBe(false);
  });

  it('Fredrick Oak: retains administrative capability, not deliver-verb wrapper', () => {
    const brand = 'Fredrick Oak Consulting';
    const best = pickBestAnchor(
      [
        'deliver dependable',
        'administrative support',
        'human resources support',
        'investigative support',
        'program support',
      ],
      { clientName: brand },
    );
    expect(best?.phrase.toLowerCase()).toMatch(/administrative|human resources|investigative|program/);
    expect(best?.phrase.toLowerCase()).not.toMatch(/^deliver\b/);
    expect(best?.phrase.toLowerCase()).not.toContain('fredrick');
  });

  it('acronym removal does not delete capability nouns', () => {
    const best = pickBestAnchor(['gcubed', 'cloud computing', 'it services'], {
      clientName: 'GCubed Enterprises LLC',
    });
    expect(best?.phrase.toLowerCase()).toMatch(/cloud|computing|services/);
    expect(best?.phrase.toLowerCase()).not.toBe('gcubed');
  });
});

describe('TAM sanity (scope-relative)', () => {
  it('flags $650B "and" market as too_broad', () => {
    const flag = evaluateTamSanity({
      anchor: 'and',
      coverage: {
        totalMarket: 650_000_000_000,
        naicsCount: 120,
        topCodePct: 3,
        allNaics: [{ code: '541512', name: 'IT', amount: 20e9 }],
        topPscList: [],
        coverageCodes: [],
        pinnedPscCodes: [],
        leadCodePct: 3,
      },
      evidence: ev(),
      leadNaics: '541512',
    });
    expect(flag).toBe('too_broad');
  });

  it('flags $1,328 concrete slice as too_narrow vs lead slice', () => {
    const flag = evaluateTamSanity({
      anchor: 'concrete reinforcement',
      coverage: {
        totalMarket: 1_328,
        naicsCount: 2,
        topCodePct: 90,
        allNaics: [{ code: '238110', name: 'Concrete', amount: 1_200 }],
        topPscList: [],
        coverageCodes: [],
        pinnedPscCodes: [],
        leadCodePct: 90,
      },
      evidence: ev(),
      leadNaics: '238110',
    });
    expect(flag).toBe('too_narrow');
  });
});

describe('forbidden anchor patterns (Morehouse Ascend)', () => {
  const cases: Array<{ name: string; keywords: string[]; brand: string; forbidden: string }> = [
    { name: 'CapitolHill', keywords: ['and', 'mental health', 'psychotherapy'], brand: 'CapitolHill Consortium', forbidden: 'and' },
    { name: 'Muse', keywords: ['helps mission-driven', 'technology services', 'software development'], brand: 'Muse Technologies', forbidden: 'helps mission-driven' },
    { name: 'W2', keywords: ['firm focused', 'management consulting', 'advisory services'], brand: 'W2 Consulting Corporation', forbidden: 'firm focused' },
    { name: 'GCubed', keywords: ['certifications', 'it services', 'cloud computing'], brand: 'GCubed Enterprises', forbidden: 'certifications' },
    { name: 'BMA', keywords: ['bma', 'program management', 'acquisition support'], brand: 'Business Management Associates', forbidden: 'bma' },
    { name: 'Anadria', keywords: ['outcomes', 'organizational development', 'training'], brand: 'Anadria Consulting', forbidden: 'outcomes' },
    { name: 'TPJ', keywords: ['customized', 'training development', 'instructional design'], brand: 'TPJ Solutions', forbidden: 'customized' },
  ];

  for (const c of cases) {
    it(`${c.name}: rejects "${c.forbidden}" as anchor`, () => {
      const best = pickBestAnchor(c.keywords, { clientName: c.brand });
      expect(best?.phrase.toLowerCase()).not.toBe(c.forbidden.toLowerCase());
      expect(best?.rejectReason).not.toBe('bare_conjunction');
      if (best) {
        expect(scoreAnchorPhrase(c.forbidden, new Set()).score).toBeLessThan(0);
      }
    });
  }

  it('IMRI: strips brand but keeps cybersecurity', () => {
    const tail = extractCapabilityTail('provides cybersecurity');
    expect(tail).toBe('cybersecurity');
    const best = pickBestAnchor(['imri', 'cybersecurity', 'provides cybersecurity'], {
      clientName: 'Information Management Resources, Inc.',
    });
    expect(best?.phrase.toLowerCase()).toMatch(/cybersecurity/);
    expect(best?.phrase.toLowerCase()).not.toBe('imri');
  });

  it('Greenup: prefers construction capability over generic filler', () => {
    const best = pickBestAnchor(
      ['general', 'civil construction', 'engineering design', 'environmental consulting'],
      { clientName: 'Greenup Industries LLC' },
    );
    expect(best?.phrase.toLowerCase()).toMatch(/construction|engineering|environmental/);
  });

  it('Undergrid: the definitional product noun beats a services-list item', () => {
    const best = pickBestAnchor(['networks', 'infrastructure', 'predictive maintenance'], {
      clientName: 'Undergrid',
      sourceText:
        'Undergrid Networks is a Physical AI company that designs, modernizes, and manages critical infrastructure systems for government, utility, industrial, transportation, and commercial clients. We provide smart infrastructure solutions that combine engineering, AI, real-time sensing, environmental intelligence, digital twins, and predictive analytics to improve the performance, resilience, and operational efficiency of water, power, telecommunications, facilities, and transportation systems. Our services include infrastructure modernization, smart facilities, infrastructure intelligence platforms, climate resilience engineering, secure communications, operational technology integration, and AI-driven monitoring and predictive maintenance solutions. We are a woman-owned, veteran-led intelligent infrastructure company.',
    });
    expect(best?.phrase.toLowerCase()).toMatch(/\bnetworks?\b/);
    expect(best?.phrase.toLowerCase()).not.toMatch(/predictive maintenance|climate resilience/);
  });
});

describe('grounded semantics', () => {
  it('sector contradiction cannot be grounded:true', () => {
    const v = validateMarketAnchor({
      anchor: 'mental health services',
      coverage: {
        totalMarket: 2e9,
        naicsCount: 5,
        topCodePct: 30,
        allNaics: [{ code: '236220', name: 'Construction', amount: 1e9 }],
        topPscList: [],
        coverageCodes: ['236220'],
        pinnedPscCodes: [],
        leadCodePct: 30,
      } as never,
      leadNaics: '236220',
      evidence: resolved({ samNaics: ['621330'], awardNaics: ['621330'], awardObligatedUsd: 5_000_000 }),
    });
    expect(v.sectorContradiction).toBe(true);
    expect(v.grounded).toBe(false);
    expect(v.anchor_confidence).not.toBe('high');
  });

  it('high confidence requires no contradiction, dominance flag, and corroborating evidence', () => {
    const evidence = resolved({ samNaics: ['561720'] });
    const v = validateMarketAnchor({
      anchor: 'janitorial services',
      coverage: {
        totalMarket: 1.9e9,
        naicsCount: 8,
        topCodePct: 28,
        allNaics: [{ code: '561720', name: 'Janitorial', amount: 5e8 }],
        topPscList: [],
        coverageCodes: ['561720'],
        pinnedPscCodes: [],
        leadCodePct: 28,
      } as never,
      leadNaics: '561720',
      evidence,
    });
    expect(v.grounded).toBe(true);
    expect(v.anchor_confidence).toBe('high');

    const vNoEvidence = validateMarketAnchor({
      anchor: 'janitorial services',
      coverage: {
        totalMarket: 1.9e9,
        naicsCount: 8,
        topCodePct: 28,
        allNaics: [{ code: '561720', name: 'Janitorial', amount: 5e8 }],
        topPscList: [],
        coverageCodes: ['561720'],
        pinnedPscCodes: [],
        leadCodePct: 28,
      } as never,
      leadNaics: '561720',
      evidence: ev(),
    });
    expect(vNoEvidence.grounded).toBe(false);
    expect(vNoEvidence.anchor_confidence).not.toBe('high');
  });

  it('a unique identity with a malformed UEI cannot go high or grounded', () => {
    const coverage = {
      totalMarket: 1.9e9,
      naicsCount: 8,
      topCodePct: 28,
      allNaics: [{ code: '541611', name: 'Admin Consulting', amount: 5e8 }],
      topPscList: [],
      coverageCodes: ['541611'],
      pinnedPscCodes: [],
      leadCodePct: 28,
    } as never;
    const naics = { samNaics: ['541611'] };
    const cases: Array<[string, string]> = [
      ['malformed', 'not-a-uei'],
      ['hyphenated-malformed', 'SYNTH-BMA-01'],
      ['11-character', 'SYNTH0BMA00'],
      ['13-character', 'BMA1BIZMGMT01'],
    ];
    for (const [label, uei] of cases) {
      const v = validateMarketAnchor({
        anchor: 'human capital strategy',
        coverage,
        leadNaics: '541611',
        evidence: ev({ identity: 'unique', identityUei: uei, identityCandidates: 1, ...naics }),
      });
      expect(v.grounded, label).toBe(false);
      expect(v.anchor_confidence, label).not.toBe('high');
    }
  });

  it('a unique identity with a valid 12-character UEI can corroborate', () => {
    const v = validateMarketAnchor({
      anchor: 'human capital strategy',
      coverage: {
        totalMarket: 5e8,
        naicsCount: 4,
        topCodePct: 25,
        allNaics: [{ code: '541611', name: 'Admin Consulting', amount: 1.25e8 }],
        topPscList: [],
        coverageCodes: ['541611'],
        pinnedPscCodes: [],
        leadCodePct: 25,
      } as never,
      leadNaics: '541611',
      evidence: resolved({ samNaics: ['541611'] }),
    });
    expect(v.grounded).toBe(true);
    expect(v.anchor_confidence).toBe('high');
  });
});

describe('mission adjectives cannot be capabilities', () => {
  it('rejects mission-focused and similar values language', () => {
    for (const phrase of [
      'mission-focused',
      'mission-focused consulting',
      'mission-driven',
      'people-always',
      'purpose-driven',
      'technology-enabled',
    ]) {
      expect(scoreAnchorPhrase(phrase, new Set()).score, phrase).toBeLessThan(0);
    }
  });

  it('BMA does not land on a mission adjective', () => {
    const best = pickBestAnchor(
      ['bma', 'mission-focused', 'mission-focused consulting', 'human capital strategy', 'workforce transformation'],
      {
        clientName: 'Business Management Associates, Inc',
        sourceText:
          'Business Management Associates, Inc. (BMA) is a 100% Woman-Owned Small Business (WOSB) delivering human capital strategy, workforce transformation, and mission-focused consulting to federal and state/local entities.',
      },
    );
    expect(best?.phrase.toLowerCase()).not.toMatch(/mission/);
    expect(best?.phrase.toLowerCase()).toMatch(/human capital|workforce/);
  });
});

describe('rankAnchorCandidates', () => {
  it('never selects merely because phrase appeared first', () => {
    const ranked = rankAnchorCandidates(['small', 'precision machining', 'CNC machining']);
    expect(ranked[0].phrase).toBe('precision machining');
  });
});
