/**
 * Morehouse Ascend 32-company regression — the ANCHOR layer.
 *
 * The e2e suite next door runs the whole tool; this one isolates anchor selection and
 * validation so a failure says WHICH layer moved. Both read the same fixture through
 * `fixtures/morehouse-ascend/harness`, and both build the anchor with the same context
 * (client name + source text) — passing different context here is how the two suites
 * would drift onto different anchors and both report green.
 *
 * Embeddings are mocked to force the lexical path: no MCP credits, deterministic output.
 */
import { describe, expect, it, vi } from 'vitest';
import { pickBestAnchor, validateMarketAnchor, emptyAnchorEvidence } from '@/lib/market/capability-anchor';
import type { AnchorEvidence } from '@/lib/market/capability-anchor';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import { participants, participantsFile, expected, caseById, keywordsFor, matchesExpectedCapability, evidenceFor, type CaseSpec } from './fixtures/morehouse-ascend/harness';

vi.mock('@/lib/market/embeddings', () => ({
  embedText: vi.fn().mockRejectedValue(new Error('lexical-only regression')),
  cosineSimilarity: vi.fn(),
}));

function assertForbidden(spec: CaseSpec, phrase: string | undefined) {
  if (!phrase) return;
  const lower = phrase.toLowerCase();
  for (const bad of spec.forbidden_anchors ?? []) expect(lower).not.toBe(bad.toLowerCase());
  for (const sub of spec.forbidden_substrings ?? []) expect(lower.includes(sub.toLowerCase())).toBe(false);
  if (spec.reject_generic_mission_led) {
    for (const sub of expected.shared_forbidden.generic_mission_led_substrings) {
      expect(lower.includes(sub.toLowerCase())).toBe(false);
    }
  }
  if (spec.reject_unrelated_rd_fallback) {
    for (const sub of expected.shared_forbidden.unrelated_rd_fallback_substrings) {
      expect(lower.includes(sub.toLowerCase())).toBe(false);
    }
  }
}

/** Coverage stub + evidence, so validation is exercised without a live market query. */
function stubValidation(anchor: string, leadNaics: string, evidence: Partial<AnchorEvidence> = {}) {
  return validateMarketAnchor({
    anchor,
    coverage: {
      totalMarket: 5e8,
      topCodePct: 25,
      naicsCount: 4,
      allNaics: [{ code: leadNaics, name: 'stub', amount: 1e8 }],
      topPscList: [],
      coverageCodes: [leadNaics],
      pinnedPscCodes: [],
      leadCodePct: 25,
    } as never,
    leadNaics,
    evidence: { ...emptyAnchorEvidence(), ...evidence },
  });
}

/** Synthetic uniquely-resolved evidence. `SYNTH0STB001` is well-formed, not a SAM registration. */
const corroborating = (naics: string): Partial<AnchorEvidence> => ({
  identity: 'unique',
  identityUei: 'SYNTH0STB001',
  identityCandidates: 1,
  samNaics: [naics],
});

describe('Morehouse Ascend fixture integrity', () => {
  it('covers all 32 participants with a case entry', () => {
    expect(participantsFile.count).toBe(32);
    expect(expected.cases).toHaveLength(32);
    for (const p of participants) expect(caseById.has(p.id), `missing case for ${p.id}`).toBe(true);
  });

  it('reports expectation-level totals', () => {
    const totals = { exact_expected: 0, behavioral_expected: 0, pending_exact_label: 0 };
    for (const c of expected.cases) totals[c.expectation_level]++;
    expect(totals).toEqual({ exact_expected: 8, behavioral_expected: 24, pending_exact_label: 0 });
  });

  it('every exact case names the capability it must land on', () => {
    const exact = expected.cases.filter((c) => c.expectation_level === 'exact_expected');
    for (const c of exact) {
      expect(c.expected_capability, `${c.participant_id} has no expected_capability`).toBeTruthy();
      expect(c.required_capability_signals?.length, c.participant_id).toBeGreaterThan(0);
    }
  });

  it('every unique fixture UEI is a well-formed 12-character synthetic identifier', () => {
    for (const p of participants) {
      const ev = evidenceFor(p.company_name);
      if (ev.identity !== 'unique') continue;
      expect(isWellFormedUei(ev.identityUei), `${p.company_name} ${ev.identityUei}`).toBe(true);
      expect(ev.identityUei, p.company_name).toHaveLength(12);
    }
  });
});

describe('matchesExpectedCapability — exact labels are material, not nearby', () => {
  it('accepts the labelled capability and close packaging, not a neighbouring industry', () => {
    expect(matchesExpectedCapability('elevator maintenance', 'elevator maintenance')).toBe(true);
    expect(matchesExpectedCapability('courier services', 'courier services')).toBe(true);
    expect(matchesExpectedCapability('engineering services', 'engineering services')).toBe(true);
    expect(matchesExpectedCapability('construction specialists', 'construction specialists')).toBe(true);
    expect(matchesExpectedCapability('administrative capability', 'administrative support services')).toBe(true);
    expect(matchesExpectedCapability('cybersecurity', 'cybersecurity risk management')).toBe(true);
    expect(matchesExpectedCapability('networks', 'networks')).toBe(true);
    expect(matchesExpectedCapability('civil/general construction', 'civil construction')).toBe(true);
    expect(matchesExpectedCapability('civil/general construction', 'general construction')).toBe(true);

    expect(matchesExpectedCapability('engineering services', 'energy solutions')).toBe(false);
    expect(matchesExpectedCapability('networks', 'infrastructure modernization')).toBe(false);
    expect(matchesExpectedCapability('elevator maintenance', 'facilities management')).toBe(false);
  });
});

describe('Morehouse Ascend — per-company anchor regression', () => {
  for (const p of participants) {
    const spec = caseById.get(p.id)!;

    it(`${p.company_name} [${spec.expectation_level}]`, async () => {
      const keywords = await keywordsFor(p);
      const best = pickBestAnchor(keywords, { clientName: p.company_name, sourceText: p.description });

      if (spec.allow_no_anchor) {
        if (!best) return;
      } else if (spec.required_behavior === 'must_not_miss' || spec.expectation_level === 'exact_expected') {
        expect(best, spec.notes ?? 'expected anchor').not.toBeNull();
      }

      assertForbidden(spec, best?.phrase);

      if (spec.expectation_level === 'exact_expected') {
        expect(
          matchesExpectedCapability(spec.expected_capability!, best?.phrase ?? null),
          `anchor "${best?.phrase}" does not match expected "${spec.expected_capability}"`,
        ).toBe(true);
      } else if (spec.required_capability_signals?.length && best) {
        const phrase = best.phrase.toLowerCase();
        expect(
          spec.required_capability_signals.some((s) => phrase.includes(s.toLowerCase())),
          `anchor "${best.phrase}" missing signals: ${spec.required_capability_signals.join(', ')}`,
        ).toBe(true);
      }

      if (!best) return;

      // Without a resolved identity nothing may be grounded, whatever the NAICS looks like.
      const unresolved = stubValidation(best.phrase, '541611');
      expect(unresolved.grounded).toBe(false);
      expect(['low', 'unverified']).toContain(unresolved.anchor_confidence);

      if (spec.must_not_claim_high_confidence_without_evidence) {
        expect(stubValidation(best.phrase, '541512').grounded).toBe(false);
      }

      for (const prefix of spec.reject_naics_prefixes ?? []) {
        const v = stubValidation(best.phrase, `${prefix}111`, corroborating(`${prefix}111`));
        expect(v.grounded).toBe(false);
        expect(v.sectorContradiction).toBe(true);
      }

      const constructionish = /concrete|construction|reinforcement|drywall|forming/.test(best.phrase.toLowerCase());
      if (constructionish) {
        for (const prefix of spec.reject_naics_prefixes_when_anchor_signals_construction ?? []) {
          const v = stubValidation(best.phrase, `${prefix}121`, corroborating(`${prefix}121`));
          expect(v.grounded).toBe(false);
          expect(v.sectorContradiction).toBe(true);
        }
      }
    });
  }
});

describe('identity is what elevates confidence, not a name hit', () => {
  it('the same anchor and NAICS are ungrounded unresolved and grounded when unique', () => {
    const anchor = 'courier services';
    expect(stubValidation(anchor, '492110', { samNaics: ['492110'] }).grounded).toBe(false);
    expect(stubValidation(anchor, '492110', { identity: 'ambiguous', identityCandidates: 3, samNaics: ['492110'] }).grounded).toBe(false);
    expect(stubValidation(anchor, '492110', corroborating('492110')).grounded).toBe(true);
  });

  it('an ambiguous match says so, rather than silently reporting no evidence', () => {
    const v = stubValidation('courier services', '492110', { identity: 'ambiguous', identityCandidates: 4 });
    expect(v.anchor_note).toMatch(/4 distinct SAM entities/);
  });
});
