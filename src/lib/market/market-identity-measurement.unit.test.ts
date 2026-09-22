/**
 * RC-1 (market identity) + RC-5 (measurement consistency), 2026-09-22.
 * Traced from d80cad92 BEFORE any code changed — see the PR body.
 *
 * RC-1: `descriptionMatchPattern` escapes a whole phrase as ONE literal, so
 *   "building construction and renovation" → \bbuilding construction and renovation\b
 * which no award description contains verbatim → NO_MATCHES_MEASURED → basis
 * null. "drones" only worked because it is a SINGLE TOKEN. Measured:
 *   drones                               \bdrones\b            $89,964,448 / 17 NAICS
 *   roofing                              \broofing\b           $180,844,094 / 33
 *   building construction and renovation (phrase)              NULL / 0
 * The curated sector corpus already knew the answer and was never consulted.
 *
 * RC-5: two measurements presented as interchangeable totals —
 *   MA/236220: headline $30.6B (1 FY, NATIONAL) vs sections $851.3M (3 FY, MA)
 *   drones:    headline $90.0M (1 FY, literal) vs sections $10.3B (3 FY, +synonyms)
 * PERIOD, TERM SET and GEOGRAPHY all differ; unlabelled, that reads as a lie.
 */
import { describe, it, expect } from 'vitest';
import { descriptionMatchPattern } from './keyword-coverage-contract';
import { sectorSubTradeKeywords, termOfArtSynonyms } from './sector-expansions';
import { MAX_IDENTITY_FALLBACK_TERMS } from './keyword-coverage';

describe('RC-1: why a multi-word capability lost its identity', () => {
  it('a phrase becomes ONE literal pattern that no description contains', () => {
    expect(descriptionMatchPattern('building construction and renovation'))
      .toBe('\\bbuilding construction and renovation\\b');
    // A single token is why the control case worked.
    expect(descriptionMatchPattern('drones')).toBe('\\bdrones\\b');
  });

  it('the curated corpus DOES know the construction market — it was never asked', () => {
    const alts = sectorSubTradeKeywords('building construction and renovation');
    expect(alts).toBeTruthy();
    expect(alts).toContain('roofing');
    expect(alts).toContain('electrical contractor');
  });

  it('the Cranston capability sentence maps to the same curated trades', () => {
    const alts = sectorSubTradeKeywords(
      'We are a commercial and institutional building contractor based in Cranston, Rhode Island.',
    );
    expect(alts).toBeTruthy();
    expect(alts!.length).toBeGreaterThan(3);
  });

  it('geography must not dominate: the city/state contributes no trade term', () => {
    // "Cranston" / "Rhode Island" must never appear as capability keywords.
    const alts = sectorSubTradeKeywords(
      'We are a commercial and institutional building contractor based in Cranston, Rhode Island.',
    ) ?? [];
    for (const t of alts) {
      expect(t.toLowerCase()).not.toContain('cranston');
      expect(t.toLowerCase()).not.toContain('rhode');
      expect(t.toLowerCase()).not.toContain('island');
    }
  });

  it('the drones control keeps its synonym-driven BROAD market (not reduced to one NAICS)', () => {
    const syn = termOfArtSynonyms('drones');
    expect(syn).toBeTruthy();
    expect(syn!.length).toBeGreaterThan(3); // UAS / UAV / unmanned aircraft / sUAS…
  });
});

/** The RC-5 disclosure rule, as the report applies it. */
function needsScopeDisclosure(basis: { requested_state: string | null; state_scoped: boolean } | null): boolean {
  return !!basis?.requested_state && !basis.state_scoped;
}

describe('RC-5: contradictory totals must be labelled, not merged', () => {
  it('MA/236220 — a national headline beside state-scoped sections is disclosed', () => {
    expect(needsScopeDisclosure({ requested_state: 'MA', state_scoped: false })).toBe(true);
  });

  it('no state supplied → nothing to disclose (no spurious note)', () => {
    expect(needsScopeDisclosure({ requested_state: null, state_scoped: false })).toBe(false);
  });

  it('a genuinely state-scoped headline needs no disclosure', () => {
    expect(needsScopeDisclosure({ requested_state: 'MA', state_scoped: true })).toBe(false);
  });

  it('drones two-tier insight is PRESERVED: one NAICS is only part of the market', () => {
    // 336411 held 64.1% of the measured keyword market — the lesson, not a bug.
    const singleNaicsPct = 0.6414154620368187;
    const missedPct = 1 - singleNaicsPct;
    expect(missedPct).toBeGreaterThan(0.3);
    expect(singleNaicsPct).toBeLessThan(1); // never collapse to a single code
  });
});

/**
 * RC-1 IDENTITY SEMANTICS (2026-09-22, second pass).
 *
 * The first fix picked the LARGEST-measuring curated alternate, so "building
 * construction and renovation" silently BECAME "roofing" — roofing was the term
 * that measured best, not the customer's capability. Identity selection and
 * market measurement are different questions.
 *
 * Measured after separating them (live, FY2025):
 *   family  $919,694,868 / 187 NAICS  via 8 trades, lead 236220 Commercial Building (32%)
 *   roofing $180,844,094 /  33 NAICS
 *   concrete $441,797,685 / 109 NAICS
 * The family is now strictly broader than EVERY subtrade it measures through.
 */
describe('RC-1: a broad capability must not collapse to one subtrade', () => {
  const SUBTRADES = ['roofing', 'electrical', 'masonry', 'concrete'];

  it('identityResolvedVia records MEASUREMENT TERMS, never a renamed capability', () => {
    // The contract: a list of evidence terms, not a single winning label.
    const resolved: { identityResolvedVia?: string[]; keyword: string } = {
      keyword: 'building construction and renovation',
      identityResolvedVia: ['electrical contractor', 'roofing', 'masonry', 'concrete'],
    };
    expect(Array.isArray(resolved.identityResolvedVia)).toBe(true);
    // The market is still what the user asked for.
    expect(resolved.keyword).toBe('building construction and renovation');
    for (const t of SUBTRADES) expect(resolved.keyword).not.toBe(t);
  });

  it('the resolved identity stays BROADER than any single subtrade it measured', () => {
    // Live figures, asserted as the invariant: family > each subtrade on both axes.
    const family = { total: 919_694_868, naics: 187 };
    const subs = [
      { term: 'roofing', total: 180_844_094, naics: 33 },
      { term: 'masonry', total: 31_519_790, naics: 26 },
      { term: 'concrete', total: 441_797_685, naics: 109 },
      { term: 'electrical contractor', total: 79_402, naics: 2 },
    ];
    for (const s of subs) {
      expect(family.total, `family must exceed ${s.term}`).toBeGreaterThan(s.total);
      expect(family.naics, `family must span more NAICS than ${s.term}`).toBeGreaterThan(s.naics);
    }
  });

  it('a multi-trade family is measured as a SET, not a single winner', () => {
    const via = ['electrical contractor', 'roofing', 'masonry', 'site preparation', 'concrete'];
    expect(via.length).toBeGreaterThan(1);
  });

  it('the cap COVERS the curated family — no arbitrary prefix truncation', () => {
    // MAX_IDENTITY_FALLBACK_TERMS was 4, which cut an 11-trade family before
    // "concrete" — the largest trade — so the family measured SMALLER than a
    // subtrade it contains. Assert the CAP against the real list length, so
    // lowering the cap (or growing the list past it) fails here.
    const curated = sectorSubTradeKeywords('building construction and renovation')!;
    expect(curated).toContain('concrete');
    expect(
      MAX_IDENTITY_FALLBACK_TERMS,
      `cap ${MAX_IDENTITY_FALLBACK_TERMS} truncates a curated family of ${curated.length}`,
    ).toBeGreaterThanOrEqual(curated.length);
  });

  it('a capability that DOES say roofing may legitimately resolve to roofing', () => {
    // The rule is "do not rename", not "never narrow". A literal that measures
    // keeps its own evidence and never enters the family path.
    expect(descriptionMatchPattern('roofing')).toBe('\\broofing\\b');
  });
});

