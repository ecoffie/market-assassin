import { describe, it, expect } from 'vitest';
import { getNaics } from './lookup';

/**
 * budget-intel/route.ts carried a 15-code inline description map and fell back
 * to the literal string 'Unknown NAICS'. A construction firm running budget
 * intel on 238220 was told their own industry was unknown — while
 * naics-codes.json (1,741 codes) was already imported four other places in the
 * same repo.
 *
 * Same class as the PSC bug: a tiny local lookup asserting an absence the real
 * reference disproves.
 */
describe('NAICS labels resolve from the real catalog', () => {
  it('resolves the codes the 15-code inline map missed', () => {
    // Each of these would have rendered "Unknown NAICS" before.
    for (const code of ['238220', '236220', '561720', '541519', '332993']) {
      const e = getNaics(code);
      expect(e, `${code} must resolve`).toBeTruthy();
      expect(e!.title.length).toBeGreaterThan(3);
    }
  });

  it('238220 is HVAC — the exact case a customer would have seen', () => {
    expect(getNaics('238220')!.title).toMatch(/plumbing|heating|air.?conditioning/i);
  });
});
