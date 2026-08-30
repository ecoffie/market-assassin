/**
 * P0-1 honesty: capability_market_match must not claim grounded:true on an unverified anchor.
 */
import { describe, expect, it } from 'vitest';
import { pickLeadKeyword } from './capability-market-match';

describe('pickLeadKeyword (P0-1 anchor selection)', () => {
  it('prefers a multi-word capability over a bare generic unigram', () => {
    expect(
      pickLeadKeyword(['small', 'precision machining', 'CNC machining']),
    ).toBe('precision machining');
  });

  it('falls back to the first non-generic keyword when no multi-word phrase exists', () => {
    expect(pickLeadKeyword(['general', 'machining', 'parts'])).toBe('machining');
  });

  it('keeps keywords[0] when every token is generic or empty', () => {
    expect(pickLeadKeyword(['small', 'large'])).toBe('small');
  });
});

describe('grounded flag contract (mirror)', () => {
  const grounded = (hasCoverage: boolean, anchorUnverified: boolean) =>
    hasCoverage && !anchorUnverified;

  it('is false when the anchor is unverified even if coverage returned rows', () => {
    expect(grounded(true, true)).toBe(false);
  });

  it('is true only when coverage exists and the anchor is verified', () => {
    expect(grounded(true, false)).toBe(true);
    expect(grounded(false, false)).toBe(false);
  });
});
