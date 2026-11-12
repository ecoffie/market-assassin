import { describe, expect, it } from 'vitest';
import { isFreshProof, proofCount, proofDollars } from './member-wins-snapshot';

describe('member proof numbers', () => {
  it('rounds down so the public claim never overstates', () => {
    expect(proofDollars(1_300_356_391)).toBe('$1.3B');
    expect(proofDollars(1_399_999_999)).toBe('$1.3B');
    expect(proofDollars(80_217_552)).toBe('$80M');
    expect(proofCount(1_789)).toBe('1,700+');
    expect(proofCount(42)).toBe('42');
  });

  it('hides missing, zero or stale snapshots', () => {
    const now = Date.parse('2026-11-12T00:00:00Z');
    const p = { lifetimeDollars: 1e9, companiesWithWins: 27, contracts: 1164, members: 1700, computedAt: '2026-11-10T00:00:00Z' };
    expect(isFreshProof(p, now)).toBe(true);
    expect(isFreshProof(null, now)).toBe(false);
    expect(isFreshProof({ ...p, lifetimeDollars: 0 }, now)).toBe(false);
    expect(isFreshProof({ ...p, computedAt: '2026-08-01T00:00:00Z' }, now)).toBe(false);
  });
});
