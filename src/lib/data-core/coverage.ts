/**
 * C5 — THREE-WAY COVERAGE CONTROL (Data Core Controls, Phase 2)
 *
 * THE PRINCIPLE (approved P0 decision, docs/data-core-p0-decisions-approved.md):
 *   A dataset's EXISTENCE, its ENRICHMENT, and our EDITORIAL JUDGMENT about it
 *   are three different claims. A control must never let one masquerade as another.
 *
 * Census trace — each kind exists because a real incident blurred it:
 *   population  /contractors titled "290,000+" while its body rendered ~2,710 from
 *               a static overlay — a 107x divergence in which both numbers were
 *               individually true and only their PAIRING was wrong (class 13).
 *   enrichment  contractors.json email coverage is 1.4%. Read as population that
 *               says "only 1.4% of contractors exist"; read as enrichment it says
 *               "we have an email for 1.4% of this overlay" (class 6/15 —
 *               registry.ts still hardcodes coveragePercent: 95).
 *   editorial   SAT friendliness covers 19 agencies of ~250-307. An uncovered
 *               agency is NOT 0% and NOT unfriendly — and until the P0 repair a
 *               generic-word match actively rendered ANOTHER agency's label.
 *
 * TWO HARD RULES, both enforced by construction:
 *   1. No denominator -> percent is NULL. A percentage is never invented.
 *   2. `uncovered` is its own state. It is never 0, never negative, never a failure.
 */
import { mayClaimCorpusSize } from './contractor-corpus';

export type CoverageKind = 'population' | 'enrichment' | 'editorial';

export type CoverageState =
  /** A real measurement with an explicit denominator. */
  | 'measured'
  /** No opinion/overlay exists for this entity. NOT zero, NOT negative. */
  | 'uncovered'
  /** The source could not be reached. NOT zero. */
  | 'unavailable'
  /** No evidence to classify. */
  | 'unmeasured';

export interface CoverageResult {
  kind: CoverageKind;
  covered: number | null;
  denominator: number | null;
  /** NULL whenever the denominator is undefined — never fabricated. */
  percent: number | null;
  state: CoverageState;
  /** What was counted, over what population. Required — a number without a basis is a claim. */
  basis: string;
  measuredAt?: string;
  /** True only for a population measurement on the canonical store. */
  maySupportCorpusSizeClaim: boolean;
}

export interface CoverageInput {
  kind: CoverageKind;
  /** Store id, checked against the approved corpus roles for population claims. */
  storeId?: string;
  covered: number | null;
  denominator: number | null;
  basis: string;
  measuredAt?: string;
  /** Set when the source could not be read — distinguishes unavailable from empty. */
  sourceUnavailable?: boolean;
}

export function measureCoverage(input: CoverageInput): CoverageResult {
  const base = {
    kind: input.kind,
    basis: input.basis,
    measuredAt: input.measuredAt,
    // ONLY a population measurement on the canonical store may back a corpus claim.
    // Enrichment and editorial can never, regardless of store.
    maySupportCorpusSizeClaim:
      input.kind === 'population' && !!input.storeId && mayClaimCorpusSize(input.storeId),
  };

  if (input.sourceUnavailable) {
    return { ...base, covered: null, denominator: null, percent: null, state: 'unavailable' };
  }

  // No denominator -> no percentage. This is the rule that stops an enrichment
  // count from being read as a share of the universe.
  if (input.denominator === null || input.denominator === 0) {
    return {
      ...base,
      covered: input.covered,
      denominator: null,
      percent: null,
      state: input.covered === null ? 'unmeasured' : 'measured',
    };
  }

  if (input.covered === null) {
    return { ...base, covered: null, denominator: input.denominator, percent: null, state: 'unmeasured' };
  }

  // Editorial: zero labels means we hold NO opinion, not a 0% score.
  if (input.kind === 'editorial' && input.covered === 0) {
    return { ...base, covered: 0, denominator: input.denominator, percent: null, state: 'uncovered' };
  }

  return {
    ...base,
    covered: input.covered,
    denominator: input.denominator,
    percent: Math.round((input.covered / input.denominator) * 1000) / 10,
    state: 'measured',
  };
}

/**
 * Human-readable phrasing that keeps the three kinds distinct. The wording is the
 * control: "2.6% of contractors" and "an email for 2.6% of the overlay" are
 * different claims, and only one of them is true.
 */
export function describeCoverage(r: CoverageResult): string {
  if (r.state === 'unavailable') return `${r.kind} coverage unavailable — source unreachable (not 0%)`;
  if (r.state === 'uncovered') return `no editorial opinion recorded (uncovered — not 0%, not negative)`;
  if (r.state === 'unmeasured') return `${r.kind} coverage unmeasured`;
  if (r.percent === null) return `${r.covered} covered; denominator undefined, so no percentage is stated`;
  switch (r.kind) {
    case 'population':
      return `${r.covered!.toLocaleString()} of ${r.denominator!.toLocaleString()} in the canonical population (${r.percent}%)`;
    case 'enrichment':
      return `enrichment available for ${r.covered!.toLocaleString()} of ${r.denominator!.toLocaleString()} (${r.percent}%) — ${r.basis}`;
    case 'editorial':
      return `editorial label present for ${r.covered} of ${r.denominator} (${r.percent}%) — absence is uncovered, not negative`;
  }
}
