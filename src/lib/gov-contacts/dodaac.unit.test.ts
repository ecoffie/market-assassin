/**
 * Unit tests for decodeDodaac — grounded in REAL sam_events solicitation numbers
 * from the 2026-07-10 decode-gap audit (tasks/dodaac-event-office-audit-2026-07.md).
 *
 * The bug: ~28% of upcoming DoD events failed to decode because (a) a trailing
 * '-<suffix>' sent FY parsing down the dashed branch and dropped the year, and
 * (b) underscore-formatted sol numbers carry no FY at chars 7-8. Fix: read FY
 * from the COMPACT position first, and accept no-FY prefixes only when they're
 * KNOWN real DoDAACs.
 */
import { describe, it, expect } from 'vitest';
import { decodeDodaac } from './dodaac';

// A stand-in "directory" of real DoDAACs (the production path passes the loaded
// dodaac_directory). Includes the codes from the audit's failing samples.
const KNOWN = new Set([
  'FA8105', 'FA8507', 'W911S6', 'N4571A', 'N61331', 'N00104', 'PANMCC', 'FD2030',
]);

describe('decodeDodaac — formats that must STILL work (regression)', () => {
  it('packed form: N0010426RX19785 → N00104, FY2026', () => {
    const d = decodeDodaac('N0010426RX19785');
    expect(d?.dodaac).toBe('N00104');
    expect(d?.fiscalYear).toBe(2026);
  });

  it('canonical dashed form: N61331-26-Q-KS35 → N61331, FY2026, RFQ', () => {
    const d = decodeDodaac('N61331-26-Q-KS35');
    expect(d?.dodaac).toBe('N61331');
    expect(d?.fiscalYear).toBe(2026);
    expect(d?.instrumentType).toBe('RFQ');
  });
});

describe('decodeDodaac — the BUG: suffix-hyphen sol numbers (fixed w/o directory)', () => {
  it('W911S626QA025-SSN → W911S6, FY2026 (the -SSN suffix is not the FY delimiter)', () => {
    const d = decodeDodaac('W911S626QA025-SSN');
    expect(d?.dodaac).toBe('W911S6');
    expect(d?.fiscalYear).toBe(2026);
  });

  it('real dashed with FY after hyphen still parses: N4571A-26-I-0002', () => {
    const d = decodeDodaac('N4571A-26-I-0002');
    expect(d?.dodaac).toBe('N4571A');
    expect(d?.fiscalYear).toBe(2026);
  });
});

describe('decodeDodaac — underscore formats (rescued via directory match)', () => {
  it('FA8105_CCR_Rev2 → FA8105 when prefix is a known DoDAAC', () => {
    const d = decodeDodaac('FA8105_CCR_Rev2', KNOWN);
    expect(d?.dodaac).toBe('FA8105');
  });

  it('FA8507_RFPDC_SourcesSought → FA8507 when known', () => {
    const d = decodeDodaac('FA8507_RFPDC_SourcesSought', KNOWN);
    expect(d?.dodaac).toBe('FA8507');
  });

  it('WITHOUT the directory, a no-FY underscore format is rejected (no false positive)', () => {
    expect(decodeDodaac('FA8105_CCR_Rev2')).toBeNull();
  });
});

describe('decodeDodaac — garbage must STILL be rejected', () => {
  it('GASKET_26: plausible-looking but NOT a real DoDAAC → null even with a directory', () => {
    expect(decodeDodaac('GASKET_26', KNOWN)).toBeNull();
  });

  it('non-DoDAAC civilian/short formats → null', () => {
    expect(decodeDodaac('5-26-0064')).toBeNull();
    expect(decodeDodaac('BSC-RFI-FY26')).toBeNull();
    expect(decodeDodaac('FCD_001')).toBeNull();
  });

  it('SAM notice UUIDs (32-char hex) → null', () => {
    expect(decodeDodaac('c164a7f2b3d4e5f60718293a4b5c6d7e')).toBeNull();
  });

  it('empty / null input → null', () => {
    expect(decodeDodaac(null)).toBeNull();
    expect(decodeDodaac('')).toBeNull();
  });

  it('a known DoDAAC prefix with an implausible FY and no directory → null (FY guard holds)', () => {
    // W911S6 followed by "99" (FY2099, out of range) and not passed a directory.
    expect(decodeDodaac('W911S699Q0001')).toBeNull();
  });
});
