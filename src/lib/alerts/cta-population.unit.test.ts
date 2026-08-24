import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A CTA COUNT AND ITS DESTINATION MUST DESCRIBE THE SAME POPULATION.
 *
 * The Today's Lens email said:
 *
 *     830 active opportunities
 *     Explore all 830 in this market →     ...linking to ?strategy=<top 3 strands>
 *
 * The map applies those strands with .contains() — has ALL THREE. Measured 2026-08-23 on a
 * 541 market: 830 promised, 77 delivered. A 10.8x gap.
 *
 * BOTH NUMBERS WERE CORRECT for their own query. The CTA was the lie: "all N" asserted that
 * the number and the link described one population, and they never did.
 *
 * The fix is NOT to make the landing page show 830. The section is headed "Your market at a
 * glance", so the market total belongs there. What was missing is the second population — and
 * naming it turns an apparent contradiction into useful narrowing.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const EMAIL = read('src/lib/alerts/todays-lens-email.ts');
const LENS = read('src/lib/dashboard/todays-lens.ts');

describe('the destination population is computed, not assumed', () => {
  it('counts the strategy slice with the SAME predicate the map uses', () => {
    // .contains() here must mirror map-filters.ts:273. If one becomes .overlaps() and the
    // other stays .contains(), the two populations silently diverge again.
    expect(LENS).toMatch(/base\(\)\.contains\('opportunity_dna_keys', lensStrategyKeys\)/);
  });

  it('derives it from the same keys that build the link', () => {
    // One definition produces the message AND the destination — the ?ss= lesson, applied to
    // a count instead of a filter.
    expect(LENS).toContain('lensStrategy: lensStrategyKeys.join(\',\')');
    expect(LENS).toMatch(/lensCount = lcErr \? null : \(lc \?\? 0\)/);
  });

  it('returns null on a failed count, never 0', () => {
    // "0 recommended" would read as "nothing matches your strategy today" — a false zero of
    // exactly the kind this codebase has been removing all day.
    expect(LENS).toMatch(/lensCount: number \| null/);
  });
});

describe('the copy names both populations', () => {
  it('no longer claims the link shows "all N"', () => {
    // The specific false promise.
    expect(EMAIL).not.toMatch(/Explore all \$\{totalLabel\} in this market/);
  });

  it('labels the market total and the strategy slice differently', () => {
    expect(EMAIL).toContain('active opportunities');
    expect(EMAIL).toContain("match today's recommended strategies");
  });

  it('the CTA promises the number the destination actually delivers', () => {
    expect(EMAIL).toMatch(/Explore \$\{lensN\.toLocaleString\('en-US'\)\} recommended/);
  });

  it('drops the number rather than guessing when the count failed', () => {
    // An unnumbered link is honest; a wrong number is not.
    expect(EMAIL).toContain("'Explore this market'");
  });

  it('hides the second line when it would not be a real narrowing', () => {
    // If the slice equals the market, two identical numbers stacked is noise, not clarity.
    expect(EMAIL).toMatch(/lensN < \(Number\(lens\.totalOpen\) \|\| 0\)/);
  });
});

describe('the overlapping-strand guard still holds', () => {
  it('never sums strand counts to produce a headline number', () => {
    // A prior incident: strands summed to 2,427 against a true totalOpen of 2,127, because one
    // notice can carry several strands. totalOpen is the only real total.
    expect(EMAIL).toContain('Number(lens.totalOpen)');
    expect(EMAIL).not.toMatch(/strands\.reduce\([^)]*\+/);
  });
});
