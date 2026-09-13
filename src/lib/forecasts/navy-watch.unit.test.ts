import { describe, it, expect } from 'vitest';
import { deriveNavySourceState } from './navy-watch';

describe('Navy source state — revision current is NOT content current', () => {
  it('THE NAVY CASE: matching revision, short population -> content_stale', () => {
    const r = deriveNavySourceState('current', 9922, 8821);
    expect(r.state).toBe('content_stale');
    expect(r.detail).toContain('9922');
    expect(r.detail).toContain('8821');
  });

  it('a newer upstream revision -> content_stale regardless of population', () => {
    expect(deriveNavySourceState('behind_upstream', 100, 100).state).toBe('content_stale');
  });

  it('unmeasured upstream can NEVER report current', () => {
    expect(deriveNavySourceState('latest_upstream_unmeasured', 9922, 8821).state).toBe('unreachable');
    expect(deriveNavySourceState('latest_upstream_unmeasured', null, null).state).toBe('unreachable');
  });

  it('an unmeasured population is not equality — never current', () => {
    expect(deriveNavySourceState('current', null, 8821).state).toBe('unmeasured');
    expect(deriveNavySourceState('current', 9922, null).state).toBe('unmeasured');
  });

  it('only a genuine match on BOTH axes is current', () => {
    expect(deriveNavySourceState('current', 9922, 9922).state).toBe('current');
  });

  it('held exceeding upstream is not stale (we are not behind)', () => {
    expect(deriveNavySourceState('current', 8000, 8821).state).toBe('current');
  });
});
