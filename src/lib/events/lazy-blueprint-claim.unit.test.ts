import { describe, expect, it } from 'vitest';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintClaimState } from './lazy-contractors-blueprint';

describe('Lazy Blueprint live credit claim', () => {
  it('gives 1,000 credits and tags the claim for the dashboard', () => {
    expect(EVENT.claimCredits).toBe(1000);
    expect(EVENT.claimTag).toBe('mindy-day-bonus-claimed');
  });
  it('is open only during the live event (11 AM–3 PM ET, Nov 28)', () => {
    expect(lazyBlueprintClaimState(new Date('2026-11-28T15:59:00Z'))).toBe('before');
    expect(lazyBlueprintClaimState(new Date('2026-11-28T16:00:00Z'))).toBe('open');
    expect(lazyBlueprintClaimState(new Date('2026-11-28T19:59:00Z'))).toBe('open');
    expect(lazyBlueprintClaimState(new Date('2026-11-28T20:00:00Z'))).toBe('after');
  });
});
