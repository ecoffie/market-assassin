/**
 * SBA certification dates — parse and preserve, never reinterpret.
 *
 * THE DEFECT (measured 2026-08-24, 250K extract lines): 507 firms (17.1% of certified) carry an
 * EXPIRED cert; 467 of them have an ACTIVE SAM registration, so nothing else flags them. The
 * expiry was in the token the importer already prefix-matches — it kept the label and dropped
 * the date, so a cert that lapsed in 2021 and one valid to 2029 both became "8(a)".
 *
 * The first acceptance cases are Eric's two sharp real-world examples.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCertifications, hasCurrentCertification, certificationLabels,
} from './certification-dates';

const ASOF = '2026-08-24';

describe('the two sharp cases — must stay identifiable, must not count as current', () => {
  // KILIUDA CONSULTING, LLC — stored ["8(a)"], registration ACTIVE, 8(a) expired 2023-01-11.
  it('KILIUDA CONSULTING: 8(a) expired 2023-01-11', () => {
    const recs = parseCertifications('A620230111', ASOF);
    expect(recs).toHaveLength(1);
    expect(recs[0].certification_type).toBe('8(a)');
    expect(recs[0].certification_expires_on).toBe('2023-01-11');
    expect(recs[0].certification_status).toBe('expired');

    // HISTORY is preserved — the firm did hold 8(a).
    expect(certificationLabels(recs)).toEqual(['8(a)']);
    // But it must NOT satisfy a "current 8(a)" surface.
    expect(hasCurrentCertification(recs, '8(a)')).toBe(false);
  });

  // ALASKA PROFESSIONAL CONSTRUCTION — stored ["HUBZone"], ACTIVE, expired 2024-03-19.
  it('ALASKA PROFESSIONAL CONSTRUCTION: HUBZone expired 2024-03-19', () => {
    const recs = parseCertifications('XX20240319', ASOF);
    expect(recs[0].certification_type).toBe('HUBZone');
    expect(recs[0].certification_status).toBe('expired');
    expect(hasCurrentCertification(recs, 'HUBZone')).toBe(false);
    expect(certificationLabels(recs)).toContain('HUBZone');   // still identifiable historically
  });
});

describe('the three states stay distinct', () => {
  it('a future date is current', () => {
    const r = parseCertifications('A620291223', ASOF)[0];
    expect(r.certification_status).toBe('current');
    expect(hasCurrentCertification([r], '8(a)')).toBe(true);
  });

  it('NO DATE is unknown — never silently upgraded to current', () => {
    // 1,234 of 1,390 HUBZone tokens (89%) carry no date. Defaulting them to current would
    // assert currency for firms we know nothing about.
    const r = parseCertifications('XX', ASOF)[0];
    expect(r.certification_expires_on).toBeNull();
    expect(r.certification_status).toBe('unknown');
    expect(hasCurrentCertification([r], 'HUBZone')).toBe(false);
  });

  it('unknown is not expired either — it is a third state', () => {
    expect(parseCertifications('XX', ASOF)[0].certification_status).not.toBe('expired');
  });

  it('a malformed date does not become a confident status', () => {
    // 99999999 is not a plausible date; asserting "current" from it would be fabrication.
    expect(parseCertifications('A699999999', ASOF)[0].certification_status).toBe('unknown');
  });
});

describe('parses what is actually encoded — verified per program', () => {
  it('JT (8(a) joint venture) maps to 8(a) and is date-bearing', () => {
    // Measured: JT is ALWAYS dated (231 of 231).
    const r = parseCertifications('JT20280708', ASOF)[0];
    expect(r.certification_type).toBe('8(a)');
    expect(r.certification_status).toBe('current');
  });

  it('A9 / A0 are NOT SBA-certified programs and are ignored', () => {
    // They carry dates but are not among the documented certified programs, so mapping them
    // would invent a certification the source never asserted.
    expect(parseCertifications('A920270930~A020260227', ASOF)).toEqual([]);
  });

  it('a dated token wins over an undated one for the same program', () => {
    const recs = parseCertifications('XX~XX20290723', ASOF);
    expect(recs).toHaveLength(1);
    expect(recs[0].certification_expires_on).toBe('2029-07-23');
    expect(recs[0].certification_status).toBe('current');
  });

  it('multiple programs are kept separately', () => {
    const recs = parseCertifications('A620230111~XX20290723', ASOF);
    expect(certificationLabels(recs)).toEqual(['8(a)', 'HUBZone']);
    expect(hasCurrentCertification(recs, '8(a)')).toBe(false);
    expect(hasCurrentCertification(recs, 'HUBZone')).toBe(true);
  });

  it('empty input yields nothing, not a default', () => {
    expect(parseCertifications('', ASOF)).toEqual([]);
    expect(parseCertifications(null, ASOF)).toEqual([]);
  });
});

describe('asOf is explicit so reprocessing an old extract does not age certs', () => {
  it('the same token is current at snapshot time and expired later', () => {
    expect(parseCertifications('A620250731', '2025-01-01')[0].certification_status).toBe('current');
    expect(parseCertifications('A620250731', '2026-08-24')[0].certification_status).toBe('expired');
  });
});
