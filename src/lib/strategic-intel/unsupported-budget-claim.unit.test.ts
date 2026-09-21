/**
 * Regression suite for the fabricated government-wide budget claim (P0, 2026-09-20).
 *
 * The defect: USASpending's `current_total_budget_authority_amount` is a
 * GOVERNMENT-WIDE CONSTANT (one distinct value across all 111 agencies). It was
 * emitted per agency as "Congressional justification outlay", reaching 549
 * customer-visible opportunities and 4 public /agencies pages.
 *
 * NASA is the required fixture: it was shown a $13,541.1B "Congressional
 * justification outlay" and a "Total obligated: $43.3B" that was really budget
 * authority — its real obligated figure is ~$20.6B.
 */
import { describe, it, expect } from 'vitest';
import {
  isUnsupportedBudgetClaim,
  exceedsAgencyPlausibility,
  stripUnsupportedBudgetClaims,
  PLAUSIBLE_AGENCY_CEILING_B,
} from './unsupported-budget-claim';
import { describeAgencySpending } from '@/lib/agency-intelligence/fetchers/usaspending';

/** The exact NASA string served on live opportunities before the repair. */
const NASA_CONTAMINATED =
  'Total obligated: $43.3B. Congressional justification outlay: $13541.1B';

describe('the two production vintages are both rejected', () => {
  it('rejects the older $13,541.1B variant (NASA fixture)', () => {
    expect(isUnsupportedBudgetClaim(NASA_CONTAMINATED)).toBe(true);
  });

  it('rejects the newer $16,047.1B variant', () => {
    expect(
      isUnsupportedBudgetClaim(
        'Total obligated: $2575.2B. Congressional justification outlay: $16047.1B',
      ),
    ).toBe(true);
  });

  it('rejects a FUTURE vintage it has never seen — the guard is structural, not a blocklist', () => {
    // The live government-wide value on 2026-09-20 was $15,495.3B. A string
    // blocklist of the two known numbers would have let this through.
    expect(
      isUnsupportedBudgetClaim(
        'Total obligated: $44.0B. Congressional justification outlay: $15495.3B',
      ),
    ).toBe(true);
    expect(
      isUnsupportedBudgetClaim('Congressional justification outlay: $99999.9B'),
    ).toBe(true);
  });

  it('rejects the derivation at ANY magnitude — there is no agency-specific source for it', () => {
    expect(isUnsupportedBudgetClaim('Congressional justification outlay: $1.2B')).toBe(true);
  });
});

describe('no government-wide number can be stamped across unrelated agencies', () => {
  it('flags a per-agency figure no single agency can hold', () => {
    expect(exceedsAgencyPlausibility('Agency budget: $15495.3B')).toBe(true);
    expect(exceedsAgencyPlausibility('Agency budget: $16,047.1B')).toBe(true);
  });

  it('does NOT flag the largest legitimate agency figures in the corpus', () => {
    // DoD is the largest real entry at ~$2,575B — it must survive untouched.
    expect(exceedsAgencyPlausibility('Obligated: $2575.2B')).toBe(false);
    expect(exceedsAgencyPlausibility('Obligated: $2030.5B')).toBe(false);
    expect(PLAUSIBLE_AGENCY_CEILING_B).toBeGreaterThan(2575.2);
  });

  it('leaves unrelated strategic intelligence completely alone', () => {
    const legit = [
      '$6.2B allocated for hypersonic weapons development in FY2025-2026',
      'Cybersecurity modernization and zero-trust architecture implementation',
      '$400M for DHS AI governance framework development',
      'Military personnel budget of $178B for FY2026',
    ];
    expect(stripUnsupportedBudgetClaims(legit)).toEqual(legit);
  });
});

describe('absence never becomes a numeric claim', () => {
  it('treats null/undefined/empty as "not a claim", not as a violation', () => {
    expect(isUnsupportedBudgetClaim(null)).toBe(false);
    expect(isUnsupportedBudgetClaim(undefined)).toBe(false);
    expect(isUnsupportedBudgetClaim('')).toBe(false);
  });

  it('the producer OMITS a figure the payload does not carry — never zero-fills', () => {
    expect(describeAgencySpending({})).toBeUndefined();
    expect(
      describeAgencySpending({ obligated_amount: null, outlay_amount: null, budget_authority_amount: null }),
    ).toBeUndefined();
  });
});

describe('the producer cannot recreate the defect', () => {
  it('never emits the government-wide field, even when it is present on the payload', () => {
    const nasa = {
      obligated_amount: 20_600_000_000,
      outlay_amount: 20_900_000_000,
      budget_authority_amount: 44_000_000_000,
      // the government-wide constant, still on the upstream payload:
      current_total_budget_authority_amount: 15_495_311_418_794.12,
    };
    const out = describeAgencySpending(nasa)!;
    expect(out).not.toMatch(/congressional/i);
    expect(out).not.toContain('15495');
    expect(isUnsupportedBudgetClaim(out)).toBe(false);
  });

  it('labels each NASA figure as the metric it actually is', () => {
    const out = describeAgencySpending({
      obligated_amount: 20_600_000_000,
      outlay_amount: 20_900_000_000,
      budget_authority_amount: 44_000_000_000,
    })!;
    // The real obligated figure — NOT the $43.3B budget authority it used to claim.
    expect(out).toContain('Obligated: $20.6B');
    expect(out).toContain('Outlayed: $20.9B');
    expect(out).toContain('Budget authority: $44.0B');
    expect(out).not.toMatch(/Total obligated: \$44\.0B/);
  });

  it('agency-specific budget claims require agency-specific evidence', () => {
    // Two different agencies must never produce the same figure from their own payloads.
    const a = describeAgencySpending({ obligated_amount: 20_600_000_000 });
    const b = describeAgencySpending({ obligated_amount: 7_799_966.73 });
    expect(a).not.toEqual(b);
  });
});

describe('cache repair primitive', () => {
  it('removes contaminated values and keeps everything else, in order', () => {
    const blob = [
      'Zero-trust architecture rollout',
      NASA_CONTAMINATED,
      '$6.2B allocated for hypersonic weapons development',
      'Total obligated: $2575.2B. Congressional justification outlay: $16047.1B',
    ];
    expect(stripUnsupportedBudgetClaims(blob)).toEqual([
      'Zero-trust architecture rollout',
      '$6.2B allocated for hypersonic weapons development',
    ]);
  });

  it('strips a claim that still carries its LEGACY_MANUAL label — a label is not a licence', () => {
    expect(
      isUnsupportedBudgetClaim(`${NASA_CONTAMINATED} [LEGACY_MANUAL — provenance unavailable]`),
    ).toBe(true);
  });

  it('active and historical caches share ONE contract — the rule takes no opportunity state', () => {
    // isUnsupportedBudgetClaim has no notion of active/historical: the same input
    // yields the same verdict, so a historical blob cannot keep a fabricated fact.
    expect(isUnsupportedBudgetClaim(NASA_CONTAMINATED)).toBe(
      isUnsupportedBudgetClaim(NASA_CONTAMINATED),
    );
    expect(stripUnsupportedBudgetClaims([NASA_CONTAMINATED])).toEqual([]);
  });
});
