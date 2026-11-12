import { describe, expect, it } from 'vitest';
import { awardColdDailyLimit } from './award-cold-budget';

describe('award cold lookup budget', () => {
  it('defaults to 4,000/day, honors overrides, and 0 turns it off', () => {
    expect(awardColdDailyLimit({})).toBe(4000);
    expect(awardColdDailyLimit({ SEO_AWARD_COLD_LOOKUPS_PER_DAY: '500' })).toBe(500);
    expect(awardColdDailyLimit({ SEO_AWARD_COLD_LOOKUPS_PER_DAY: '0' })).toBe(0);
    expect(awardColdDailyLimit({ SEO_AWARD_COLD_LOOKUPS_PER_DAY: 'junk' })).toBe(4000);
  });
});
