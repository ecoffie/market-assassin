import { describe, it, expect } from 'vitest';
import { assertProbeValid, assertRankingComplete } from './postconditions';

/**
 * PHASE 2 RULE (Eric): a control only counts as coverage if it reproduces and blocks the
 * ORIGINAL production incident. Both blocks below replay real incidents from this audit —
 * including two of my own diagnostic failures, which is the honest place to test INT-008.
 */

describe('INT-008 — the diagnostic probe is itself invalid', () => {
  it('BLOCKS incident 1: a probe that hit the very cap it was measuring', () => {
    // I sampled alert_log to measure the 1,000-row cap, and the sample was capped at 1,000.
    // It reported a confident "750/cycle, flat for 10 weeks" from truncated data.
    const r = assertProbeValid('alert_log cap sample', 1000, { capAt: 1000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/truncated, not measured/);
  });

  it('BLOCKS incident 2: curl -w printed blank and I read it as "HTTP 000 / blocked"', () => {
    // The probe was malformed. Supabase was neither blocked nor failing — but a blank string
    // read as a status code produced a whole false diagnosis.
    const r = assertProbeValid('curl http_code', '', { emptyIsInvalid: true });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/malformed probe/);
  });

  it('rejects a probe that cannot discriminate (same answer for the control)', () => {
    // The deepest form: a gate that returns "pass" for known-good AND known-bad input.
    const r = assertProbeValid('gate', 'pass', { control: 'pass' });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/cannot discriminate/);
  });

  it('treats a missing result as a failed measurement, never as a value', () => {
    expect(assertProbeValid('x', null).valid).toBe(false);
    expect(assertProbeValid('x', undefined).valid).toBe(false);
  });

  it('accepts a probe that genuinely could have answered differently', () => {
    const r = assertProbeValid('alert_log cap sample', 2633, { capAt: 1000, control: 0 });
    expect(r.valid).toBe(true);
  });

  it('a real measured value BELOW the cap is valid', () => {
    expect(assertProbeValid('sends/24h', 750, { capAt: 1000 }).valid).toBe(true);
  });
});

describe('INT-010 — partial population corrupts ordering', () => {
  it('BLOCKS the original incident: agencies ranked from 6.6% of open notices', () => {
    // target-market-research ranked agencies over 1,000 of 15,065 open notices. No count was
    // displayed, so nothing looked wrong — but which agency was #1 came from the first page.
    const r = assertRankingComplete('agencies by open opps', 1000, 15065);
    expect(r.complete).toBe(false);
    expect(r.presentable).toBe(false);
    expect(r.detail).toMatch(/the ORDER is an artifact/);
    expect(r.detail).toMatch(/7%|6%/); // ~6.6%
  });

  it('allows a ranking computed over the complete population', () => {
    const r = assertRankingComplete('agencies by open opps', 15065, 15065);
    expect(r.complete).toBe(true);
    expect(r.presentable).toBe(true);
  });

  it('refuses to defend a ranking when the population is unknown', () => {
    // INT-002 applied to ordering: unknown is not "probably fine".
    const r = assertRankingComplete('top markets', 500, null);
    expect(r.presentable).toBe(false);
    expect(r.detail).toMatch(/population unknown/);
  });

  it('catches a ranking that is only slightly short — order can flip on one row', () => {
    expect(assertRankingComplete('top buyers', 14999, 15065).presentable).toBe(false);
  });
});
