import { describe, it, expect } from 'vitest';
import { tierAtLeast, hasPaidProductTier } from './tier-rank';

describe('product tier hierarchy', () => {
  it('Team and Enterprise inherit every Pro capability', () => {
    for (const t of ['pro', 'team', 'enterprise']) expect(hasPaidProductTier(t)).toBe(true);
  });

  it('free, none and unknown tiers get no paid capability', () => {
    for (const t of ['free', 'none', '', null, undefined, 'legacy_briefings', 'PRO']) expect(hasPaidProductTier(t)).toBe(false);
  });

  it('Team-only capabilities exclude Pro but include Enterprise', () => {
    expect(tierAtLeast('pro', 'team')).toBe(false);
    expect(tierAtLeast('team', 'team')).toBe(true);
    expect(tierAtLeast('enterprise', 'team')).toBe(true);
  });
});
