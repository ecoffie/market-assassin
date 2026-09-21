/**
 * Market-depth calibration (FM-03, Eric/QA 2026-07-28). The bug: `rule_of_two_met=true` sitting on 0
 * CAPABLE performers — because the gate used market_depth, which (with include_emerging) counts EMERGING
 * registrants. A "wide but shallow" market (200 emerging, 0 capable) read as "Rule of Two MET" over zero
 * proven performers. Fix: the Rule of Two gates on CAPABLE depth (active_performer + capable) only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const research = readFileSync(join(__dirname, '../../lib/gov-buyer/market-research.ts'), 'utf8');
const tool = readFileSync(join(__dirname, 'market-depth.ts'), 'utf8');

describe('Rule of Two gates on CAPABLE depth, not emerging (FM-03)', () => {
  it('capableDepth = active_performer + capable ONLY (no emerging)', () => {
    expect(research).toContain('const capableDepth = counts.active_performer + counts.capable;');
    // and the gate uses capableDepth, NOT marketDepth.
    // Matched as a pattern rather than an exact string: 2026-08-23 the expression gained a
    // degraded guard (`activityDegraded ? null : capableDepth >= 2`) so a BigQuery failure
    // can no longer be reported as "Rule of Two NOT met". The INVARIANT this test exists to
    // protect — gate on capableDepth, never marketDepth — is unchanged, so the assertion
    // should track the invariant, not the literal text.
    expect(research).toMatch(/ruleOfTwoMet:[^\n]*capableDepth >= 2/);
    expect(research).not.toMatch(/ruleOfTwoMet:[^\n]*marketDepth >= 2/);
    expect(research).not.toContain('ruleOfTwoMet: marketDepth >= 2');
  });

  // The exact QA case, as a pure-logic check mirroring the source formula.
  const ruleOfTwo = (active: number, capable: number, emerging: number, includeEmerging: boolean) => {
    const marketDepth = active + capable + (includeEmerging ? emerging : 0);
    const capableDepth = active + capable;
    return { marketDepth, capableDepth, met: capableDepth >= 2 };
  };

  it('200 emerging / 0 capable → NOT met (the FM-03 bug case)', () => {
    const r = ruleOfTwo(0, 0, 200, true);
    expect(r.marketDepth).toBe(200);     // the old (misleading) number
    expect(r.capableDepth).toBe(0);
    expect(r.met).toBe(false);           // the honest determination
  });
  it('2 capable / any emerging → met', () => {
    expect(ruleOfTwo(1, 1, 50, true).met).toBe(true);
    expect(ruleOfTwo(0, 2, 0, false).met).toBe(true);
  });
  it('1 capable → not met (a single performer is not the Rule of Two)', () => {
    expect(ruleOfTwo(1, 0, 99, true).met).toBe(false);
  });
});

describe('the tool surfaces capable_depth + an honest "wide but shallow" headline', () => {
  it('capable_depth is a first-class field + in _meta', () => {
    expect(tool).toContain('capable_depth: number;');
    expect(tool).toContain('capable_depth: capableDepth');
  });
  it('the hint headline is CAPABLE-based and flags WIDE but SHALLOW', () => {
    expect(tool).toContain('CAPABLE small business');
    expect(tool).toContain('WIDE but SHALLOW');
    // gated on capable_depth, explicitly NOT market_depth
    expect(tool).toContain('gated on capable_depth, NOT market_depth');
  });
});
