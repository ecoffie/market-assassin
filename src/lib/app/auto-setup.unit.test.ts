import { describe, it, expect } from 'vitest';
import {
  mergeScanAgencies,
  clampSetAsideSpending,
  validOfficeCode,
  emptyScanOutcome,
  type ScanAgency,
} from './auto-setup';

const a = (over: Partial<ScanAgency>): ScanAgency => ({ name: 'X', ...over });

describe('mergeScanAgencies', () => {
  it('dedups by name+office (case-insensitive), keeping the HIGHEST set-aside spend', () => {
    const out = mergeScanAgencies([
      [a({ name: 'Army', contractingOffice: 'ACC', setAsideSpending: 100 })],
      [a({ name: 'army', contractingOffice: 'acc', setAsideSpending: 500 })], // same key, higher
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].setAsideSpending).toBe(500);
  });

  it('keeps different offices of the same agency as distinct rows', () => {
    const out = mergeScanAgencies([[
      a({ name: 'Navy', contractingOffice: 'NAVSUP', setAsideSpending: 10 }),
      a({ name: 'Navy', contractingOffice: 'NAVSEA', setAsideSpending: 20 }),
    ]]);
    expect(out).toHaveLength(2);
  });

  it('sorts spend-descending (top buyers first) and tolerates empty/missing lists', () => {
    const out = mergeScanAgencies([
      [a({ name: 'Low', setAsideSpending: 1 })],
      [],
      [a({ name: 'High', setAsideSpending: 999 }), a({ name: 'Mid', setAsideSpending: 50 })],
    ]);
    expect(out.map((x) => x.name)).toEqual(['High', 'Mid', 'Low']);
  });
});

describe('clampSetAsideSpending (billions guard — the silent-batch-kill fix)', () => {
  it('rounds to an integer', () => {
    expect(clampSetAsideSpending(1234.7)).toBe(1235);
  });
  it('caps at 9,000,000,000 so it never overflows the column', () => {
    expect(clampSetAsideSpending(50_000_000_000)).toBe(9_000_000_000);
  });
  it('treats null/undefined/NaN as 0', () => {
    expect(clampSetAsideSpending(undefined)).toBe(0);
    expect(clampSetAsideSpending(null)).toBe(0);
    expect(clampSetAsideSpending(NaN)).toBe(0);
  });
});

describe('validOfficeCode (DoDAAC guard — reject FPDS junk)', () => {
  it('accepts a real 6-char DoDAAC, uppercased/trimmed', () => {
    expect(validOfficeCode('w912pl')).toBe('W912PL');
    expect(validOfficeCode('  N00104 ')).toBe('N00104');
  });
  it('rejects postcode-ish junk + wrong lengths + null', () => {
    for (const bad of ['GU22', 'CA09', 'W912', 'W912PLX', '123456', '', null, undefined]) {
      expect(validOfficeCode(bad)).toBeNull();
    }
  });
});

describe('emptyScanOutcome (empty-vs-failed branch — the silent-failure fix)', () => {
  it('every scan errored → 502', () => {
    expect(emptyScanOutcome(3, 3)).toEqual({ allFailed: true, status: 502 });
  });
  it('genuinely empty (no errors) → 200', () => {
    expect(emptyScanOutcome(0, 3)).toEqual({ allFailed: false, status: 200 });
  });
  it('partial errors (some scans returned) → 200, not a hard failure', () => {
    expect(emptyScanOutcome(1, 3)).toEqual({ allFailed: false, status: 200 });
  });
});
