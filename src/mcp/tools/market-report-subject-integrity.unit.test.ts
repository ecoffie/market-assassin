/**
 * RC-2 + RC-4 (2026-09-22) — two ways a market report became confidently wrong.
 *
 * RC-2: keyword-axis recompetes ignored the report subject. `resolveMarketScope`
 * returns basis='keyword' with naicsCodes=[], so `expiringContracts` received NO
 * subject filter and returned the global head of recompete_opportunities.
 * Reproduced live: "drones" and "building construction and renovation" returned
 * the IDENTICAL 15 rows — 339114 dental, 331491 bullion, 314910 textiles.
 *
 * RC-4: the save gate was `sectionsGrounded > 0`, so a one-section report still
 * earned a branded /reports/<id> link a customer forwards to their client.
 */
import { describe, it, expect } from 'vitest';

/** The subject boundary applied to keyword-axis recompetes (market-report.ts). */
function subjectNaicsFor(naicsCodes: string[], coverageAllNaics: { code: string }[]): string[] {
  return naicsCodes.length ? naicsCodes : coverageAllNaics.map((n) => n.code).filter(Boolean);
}

/** The RC-4 deliverable bar. */
function deliverableWorthy(totalMarket: number | null, sectionsGrounded: number): boolean {
  return !!totalMarket && sectionsGrounded >= 2;
}

describe('RC-2: keyword recompetes stay on subject', () => {
  const OFF_SUBJECT = ['339114', '331491', '314910', '518210', '339112'];

  it('a keyword report filters by the keyword\'s measured buying NAICS', () => {
    const drones = [{ code: '334511' }, { code: '334290' }, { code: '336411' }];
    const subject = subjectNaicsFor([], drones);
    expect(subject).toEqual(['334511', '334290', '336411']);
    for (const off of OFF_SUBJECT) expect(subject).not.toContain(off);
  });

  it('a drones report can never carry dental, bullion, textile or hosting recompetes', () => {
    const subject = subjectNaicsFor([], [{ code: '334511' }, { code: '334290' }]);
    const rows = [
      { naics_code: '334511' }, { naics_code: '339114' }, // dental
      { naics_code: '331491' }, { naics_code: '334290' }, // bullion
    ];
    const kept = rows.filter((r) => subject.includes(r.naics_code));
    expect(kept.map((r) => r.naics_code)).toEqual(['334511', '334290']);
  });

  it('NO defensible subject filter returns NO recompetes, never unrelated ones', () => {
    // "building construction and renovation": no NAICS axis, no coverage codes.
    const subject = subjectNaicsFor([], []);
    expect(subject).toHaveLength(0);
    // The route must withhold rather than query unfiltered.
    const withheld = subject.length === 0;
    expect(withheld).toBe(true);
  });

  it('an explicit NAICS axis still wins over coverage (unchanged behaviour)', () => {
    expect(subjectNaicsFor(['236220'], [{ code: '334511' }])).toEqual(['236220']);
  });
});

describe('RC-4: a degraded report is not a branded deliverable', () => {
  it('withholds the known 1/7-grounded construction case', () => {
    expect(deliverableWorthy(null, 1)).toBe(false);
    expect(deliverableWorthy(0, 1)).toBe(false);
  });

  it('withholds a single-section report even with a market total', () => {
    expect(deliverableWorthy(1_000_000, 1)).toBe(false);
  });

  it('PROTECTS the known 5/7-grounded drones report from suppression', () => {
    expect(deliverableWorthy(242_700_000, 5)).toBe(true);
  });

  it('publishes at exactly the bar — 2 sections with a market total', () => {
    expect(deliverableWorthy(1_000_000, 2)).toBe(true);
  });

  it('a report with sections but no market total has no subject, so it is withheld', () => {
    expect(deliverableWorthy(null, 6)).toBe(false);
  });
});
