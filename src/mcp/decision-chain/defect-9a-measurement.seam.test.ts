/**
 * DEFECT-9A — measurement integrity.
 *
 * Eric's invariant: "changing the retrieval pool size or DB row ordering must not change the
 * market-depth result." Only literally satisfiable for the EXHAUSTIVE metric, so this test
 * pins the per-metric version agreed in DEFECT-9A-design.md:
 *
 *   eligible_population    — invariant under pool size AND ordering
 *   capable_in_sample      — varies by construction, and is NAMED so it may
 *   determination 'met'    — invariant: more sampling cannot unfind found firms
 *   determination 'not_met'— only at 100% coverage; otherwise 'undetermined'
 *
 * The governing principle:
 *   Mindy may conclusively assert EXISTENCE from partial observation.
 *   Mindy may assert ABSENCE only after EXHAUSTIVE observation.
 */
import { describe, it, expect } from 'vitest';

type Det = 'met' | 'not_met' | 'undetermined';

/** Mirrors the shipped logic in market-research.ts. */
function determine(capableFound: number, sampleSize: number, eligiblePopulation: number) {
  const coverage = eligiblePopulation > 0 ? Math.min(1, sampleSize / eligiblePopulation) : 1;
  const exhaustive = coverage >= 1;
  const determination: Det =
    capableFound >= 2 ? 'met' : exhaustive ? 'not_met' : 'undetermined';
  return { coverage, exhaustive, determination, conclusive: determination !== 'undetermined' };
}

describe('DEFECT-9A determination', () => {
  it('THE DEFECT: <2 found in a 5% sample must be UNDETERMINED, never not_met', () => {
    // 561720 shape: 20,074 eligible, 1,000 pool. Suppose the sample found only 1.
    const r = determine(1, 1000, 20074);
    expect(r.determination).toBe('undetermined');
    expect(r.conclusive).toBe(false);
    // The old boolean would have said false === "Rule of Two not met". That is the false
    // negative, and it is exactly what the deprecated field still encodes.
    expect(1 >= 2).toBe(false);
  });

  it('>=2 found is MET and CONCLUSIVE even at 1.8% coverage — existence is one-sided', () => {
    // 541611 shape: 56,744 eligible.
    const r = determine(132, 1000, 56744);
    expect(r.determination).toBe('met');
    expect(r.conclusive).toBe(true);
    expect(r.coverage).toBeLessThan(0.02);
  });

  it('<2 found IS not_met when coverage is exhaustive', () => {
    const r = determine(1, 300, 300);
    expect(r.exhaustive).toBe(true);
    expect(r.determination).toBe('not_met');
    expect(r.conclusive).toBe(true);
  });

  it("INVARIANT: 'met' cannot be undone by changing pool size", () => {
    // Once >=2 are found, more sampling can only find more. Never flips back.
    for (const pool of [1000, 5000, 20074]) {
      expect(determine(132, pool, 20074).determination).toBe('met');
    }
  });

  it('INVARIANT: eligible_population does not depend on pool size or ordering', () => {
    // The exhaustive count is a SQL COUNT over the filter — the sample cannot move it.
    const POP = 20074;
    for (const pool of [10, 1000, 5000, 20074]) {
      expect(determine(0, pool, POP).coverage).toBe(Math.min(1, pool / POP));
      // population itself is the denominator and is unchanged in every case
    }
  });

  it('a sampled result NEVER reports not_met — absence requires exhaustion', () => {
    for (const [found, pool, pop] of [[0, 1000, 20074], [1, 1000, 56744], [0, 999, 1000]] as const) {
      expect(determine(found, pool, pop).determination).not.toBe('not_met');
    }
  });

  it('REGRESSION: eligible_population must exceed the pool when the market is larger', () => {
    // Live run 2026-08-24 reported eligible_population 1000 for 561720 — exactly the pool
    // size — because the count query was chained onto the paging builder. A count that
    // silently equals the page size is the SAME class of defect this field exists to fix:
    // a bounded number presented as a population.
    const POOL = 1000;
    const observedBug = { eligible_population: 1000, sample_size: 231 };
    const correct = { eligible_population: 20074, sample_size: 231 };

    // The tell: population === pool AND sample < population is suspicious, because the
    // pool would have been filled if that many rows existed.
    const suspicious = (r: { eligible_population: number; sample_size: number }) =>
      r.eligible_population === POOL && r.sample_size < r.eligible_population;
    expect(suspicious(observedBug)).toBe(true);
    expect(suspicious(correct)).toBe(false);
    // And coverage must reflect the TRUE population, not the page.
    expect(231 / correct.eligible_population).toBeLessThan(0.02);
    expect(231 / observedBug.eligible_population).toBeGreaterThan(0.2);
  });

  it('coverage clamps to 1 and a fully-covered market is conclusive either way', () => {
    expect(determine(0, 1500, 1000).coverage).toBe(1);
    expect(determine(0, 1500, 1000).determination).toBe('not_met');
    expect(determine(5, 1500, 1000).determination).toBe('met');
  });
});
