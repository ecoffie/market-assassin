/**
 * The DERIVED M-Estimate (predecessor inference + comparable-award band) is for OPEN opportunities
 * ONLY (Eric 2026-08-03: "do it for opps not recompetes"). A recompete/awarded listing carries its
 * OWN real contract value; deriving one is wasteful AND the source of the wrong-predecessor bug
 * class. buildOppIntel gains opts.estimate — the recompete-detail drawer passes estimate:false so it
 * only computes agency + pricing (verified live: estimate:false -> predecessor null, valueRange null).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'opp-intel.ts'), 'utf8');
const rcRoute = readFileSync(join(__dirname, '../../app/api/app/recompete-detail/route.ts'), 'utf8');

describe('M-Estimate derivation is open-opps-only', () => {
  it('buildOppIntel gates the predecessor + comparable-range calls on opts.estimate', () => {
    expect(src).toContain('const wantEstimate = opts.estimate !== false');
    expect(src).toContain('wantEstimate ? guard(findPredecessorAward(');
    expect(src).toContain('(wantEstimate && naics) ? guard(getComparableAwardRange(');
  });
  it('the recompete-detail drawer opts OUT (estimate:false) — it uses the row\'s real value', () => {
    expect(rcRoute).toContain('{ estimate: false }');
  });
  it('open opps default to estimate ON (opts absent → wantEstimate true)', () => {
    // the default path (no opts) keeps the estimate — the sam_opportunities precompute + open drawer
    expect(src).toContain('opts.estimate !== false'); // absent opts => !== false => true
  });
});
