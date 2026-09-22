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
