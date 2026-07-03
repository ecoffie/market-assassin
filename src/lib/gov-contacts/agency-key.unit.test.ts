import { describe, it, expect } from 'vitest';
import { normalizeAgencyKey, isValidDodaac } from './agency-key';

/**
 * normalizeAgencyKey is the join key that made TMR event counts and open_opp_count
 * backfills agree with the live research view (memory: DoD office anchoring). If it
 * drifts, department-level agencies stop matching and counts inflate/vanish. isValidDodaac
 * gates the office-anchoring path (only a real 6-char DoDAAC filters by solicitation prefix).
 */

describe('normalizeAgencyKey — stable department key', () => {
  it('collapses the common "Department of Defense" spellings to one key', () => {
    const forms = [
      'Department of Defense',
      'DEPT OF DEFENSE',
      'DEPARTMENT OF DEFENSE',
      'department of the defense',
    ];
    const keys = forms.map(normalizeAgencyKey);
    // every spelling normalizes to the SAME key
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('DEFENSE');
  });

  it('handles the trailing ", DEPARTMENT OF" form (SAM style)', () => {
    expect(normalizeAgencyKey('VETERANS AFFAIRS, DEPARTMENT OF'))
      .toBe(normalizeAgencyKey('Department of Veterans Affairs'));
  });

  it('strips filler tokens (DEPARTMENT/OF/THE/US/ADMINISTRATION/AGENCY/NATIONAL)', () => {
    expect(normalizeAgencyKey('U.S. General Services Administration')).toBe('GENERAL SERVICES');
    expect(normalizeAgencyKey('National Aeronautics and Space Administration')).toBe('AERONAUTICS AND SPACE');
  });

  it('is idempotent — normalizing a key again yields the same key', () => {
    const once = normalizeAgencyKey('Department of Homeland Security');
    expect(normalizeAgencyKey(once)).toBe(once);
  });

  it('collapses punctuation + whitespace and uppercases', () => {
    expect(normalizeAgencyKey('  energy,   dept.  ')).toBe('ENERGY');
  });

  it('returns an empty string for null/undefined/blank (no crash)', () => {
    expect(normalizeAgencyKey('')).toBe('');
    // @ts-expect-error exercising the null guard
    expect(normalizeAgencyKey(null)).toBe('');
    // @ts-expect-error exercising the undefined guard
    expect(normalizeAgencyKey(undefined)).toBe('');
  });
});

describe('isValidDodaac — the office-anchoring gate', () => {
  it('accepts a real 6-char DoDAAC (letter + 5 alphanumerics)', () => {
    expect(isValidDodaac('W912PL')).toBe(true); // USACE LA District
    expect(isValidDodaac('W912BV')).toBe(true); // Tulsa
    expect(isValidDodaac('N0002A')).toBe(true);
  });

  it('is case-insensitive (lowercases are upcased before the test)', () => {
    expect(isValidDodaac('w912pl')).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isValidDodaac('  W912PL  ')).toBe(true);
  });

  it('rejects wrong length, a leading digit, or punctuation', () => {
    expect(isValidDodaac('W912P')).toBe(false);      // 5 chars
    expect(isValidDodaac('W912PLX')).toBe(false);    // 7 chars
    expect(isValidDodaac('1912PL')).toBe(false);     // starts with a digit
    expect(isValidDodaac('W-912P')).toBe(false);     // punctuation
  });

  it('rejects null/undefined/blank', () => {
    expect(isValidDodaac('')).toBe(false);
    expect(isValidDodaac(null)).toBe(false);
    expect(isValidDodaac(undefined)).toBe(false);
  });
});
