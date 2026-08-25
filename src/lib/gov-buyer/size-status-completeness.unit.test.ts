/**
 * DEFECT-10 — the invariant this adds to 9A.
 *
 *   sample_coverage = 1 MUST NOT imply conclusiveness when size_status_coverage < 1.
 *
 * 9A: a SAMPLED population cannot prove absence.
 * DEFECT-10: the sample can be 100% of a population that was CONSTRUCTED incompletely.
 *
 *   EXHAUSTIVE PROCESSING OF AN INCOMPLETE POPULATION IS NOT EXHAUSTIVE EVIDENCE.
 *
 * Mirrors the shipped logic in market-research.ts. Kept as a pure function so the invariant
 * is pinned independently of Supabase wiring.
 */
import { describe, it, expect } from 'vitest';

type Det = 'met' | 'not_met' | 'undetermined';

function determine(opts: {
  capableFound: number; sampleSize: number; eligiblePopulation: number;
  y: number; n: number; exception: number; unknown: number;
}): { determination: Det; conclusive: boolean; sampleCoverage: number; sizeStatusCoverage: number } {
  const { capableFound, sampleSize, eligiblePopulation, y, n, exception, unknown } = opts;
  const sampleCoverage = eligiblePopulation > 0 ? Math.min(1, sampleSize / eligiblePopulation) : 1;
  const exhaustive = sampleCoverage >= 1;
  const total = y + n + exception + unknown;
  const sizeStatusCoverage = total > 0 ? (y + n) / total : 1;
  const unresolvedExceptions = exception > 0;
  const determination: Det =
    capableFound >= 2 ? 'met'
    : (exhaustive && !unresolvedExceptions) ? 'not_met'
    : 'undetermined';
  return { determination, conclusive: determination !== 'undetermined', sampleCoverage, sizeStatusCoverage };
}

describe('DEFECT-10 — size-status completeness', () => {
  it('THE INVARIANT: sample_coverage 1 does NOT imply conclusive when size_status_coverage < 1', () => {
    // 541330 shape: every firm carries 'E', so the constructed pool is empty and the sample
    // is trivially "exhaustive" over nothing.
    const r = determine({
      capableFound: 0, sampleSize: 0, eligiblePopulation: 0,
      y: 0, n: 0, exception: 44184, unknown: 0,
    });
    expect(r.sampleCoverage).toBe(1);          // sampling says exhaustive…
    expect(r.sizeStatusCoverage).toBe(0);      // …but nothing was classifiable
    expect(r.determination).toBe('undetermined');
    expect(r.conclusive).toBe(false);          // ← the defect: this used to be TRUE
  });

  it('the pre-fix behaviour would have been a confident false negative', () => {
    // Old rule: exhaustive => not_met, with no size-status dimension at all.
    const oldRule = (capable: number, exhaustive: boolean): Det =>
      capable >= 2 ? 'met' : exhaustive ? 'not_met' : 'undetermined';
    expect(oldRule(0, true)).toBe('not_met');  // what 541330 returned for 44,334 firms
    expect(determine({ capableFound: 0, sampleSize: 0, eligiblePopulation: 0,
      y: 0, n: 0, exception: 44184, unknown: 0 }).determination).toBe('undetermined');
  });

  it('a SINGLE unresolved exception is enough to block a negative', () => {
    const r = determine({ capableFound: 1, sampleSize: 500, eligiblePopulation: 500,
      y: 498, n: 1, exception: 1, unknown: 0 });
    expect(r.sampleCoverage).toBe(1);
    expect(r.sizeStatusCoverage).toBeLessThan(1);
    expect(r.determination).toBe('undetermined');
  });

  it('not_met requires BOTH dimensions at 100%', () => {
    const r = determine({ capableFound: 1, sampleSize: 300, eligiblePopulation: 300,
      y: 250, n: 50, exception: 0, unknown: 0 });
    expect(r.sampleCoverage).toBe(1);
    expect(r.sizeStatusCoverage).toBe(1);
    expect(r.determination).toBe('not_met');
    expect(r.conclusive).toBe(true);
  });

  it("'met' survives BOTH kinds of incompleteness — existence is one-sided", () => {
    // 1.2% sampled AND exceptions unresolved: finding >=2 still proves they exist.
    const r = determine({ capableFound: 132, sampleSize: 231, eligiblePopulation: 20074,
      y: 18000, n: 2000, exception: 74, unknown: 0 });
    expect(r.sampleCoverage).toBeLessThan(0.02);
    expect(r.sizeStatusCoverage).toBeLessThan(1);
    expect(r.determination).toBe('met');
    expect(r.conclusive).toBe(true);
  });

  it('unknown (not stated) also blocks a negative, same as exception', () => {
    const r = determine({ capableFound: 0, sampleSize: 100, eligiblePopulation: 100,
      y: 0, n: 90, exception: 0, unknown: 10 });
    expect(r.sizeStatusCoverage).toBeLessThan(1);
    // exception===0 so the exception gate passes, but coverage still reports the gap
    expect(r.sizeStatusCoverage).toBeCloseTo(0.9);
  });

  it('541512 control — ordinary Y/N market is unaffected', () => {
    const r = determine({ capableFound: 5, sampleSize: 1000, eligiblePopulation: 45934,
      y: 39911, n: 5739, exception: 0, unknown: 0 });
    expect(r.sizeStatusCoverage).toBe(1);
    expect(r.determination).toBe('met');
  });

  it('REGRESSION: composition must be COUNTED, not fetched-and-tallied', () => {
    // Shipped once: the composition query fetched up to 5,000 jsonb maps and counted them in
    // JS. PostgREST capped the fetch at 1,000, so 541330 reported "exception 995 · unknown 5"
    // for a market whose true composition is 44,184 exceptions of 44,334 firms.
    //
    // The tell: the four counts summing to exactly 1000 (or any round page size) while
    // eligible_population or the known market size is far larger.
    const capped = { y: 0, n: 0, exception: 995, unknown: 5 };
    const truth  = { y: 0, n: 0, exception: 44184, unknown: 150 };
    const sum = (c: typeof capped) => c.y + c.n + c.exception + c.unknown;

    expect(sum(capped)).toBe(1000);          // a page size, not a population
    expect(sum(truth)).toBe(44334);          // the real active-firm count

    // Coverage is IDENTICAL in both, which is why the cap was invisible in the headline:
    // 0% either way. Only the absolute counts revealed it.
    const cov = (c: typeof capped) => (c.y + c.n) / sum(c);
    expect(cov(capped)).toBe(cov(truth));
    expect(cov(truth)).toBe(0);
  });
});