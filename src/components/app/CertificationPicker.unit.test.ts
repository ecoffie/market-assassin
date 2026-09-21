import { describe, it, expect } from 'vitest';
import { splitCertifications } from './CertificationPicker';
import { normalizeCertifications } from '@/lib/vault/certifications';

// Every distinct certifications value in prod, 2026-07-31.
const PROD = [
  ['WOSB'], ['Small Business'], ['EDWOSB'], ['8(a)'], ['MBE'], ['SDVOSB'], ['VOSB'],
  ['Active Secret Facility Clearance (FCL)'], ['HUBZone'], ['ISO 27001 aligned'],
  ['M/WBE certified by SBA of NYC'], ['SBA Tribal 8(a)'], ['SBE'], ['SDB'],
  ['SDVOSB;VOSB;WOSB'], ['SDVOSB.WOSB'], ['SMALL BUSINESS'],
  ['Small Business Florida Certified General Contractor (CGC1540142)'],
  ['Small Disadvantaged Business'], ['SOC 2 Type II'], ['WBE'],
  ['WOSB certified by U.S. SBA'],
  ['8(a)', 'WOSB'], ['WOSB certified by U.S. SBA', 'M/WBE certified by SBA of NYC'],
];

describe('splitCertifications — NOTHING a user saved may be lost', () => {
  for (const saved of PROD) {
    it(`round-trips ${JSON.stringify(saved)}`, () => {
      const { known, otherRaw } = splitCertifications(saved);
      const rejoined = [...known, ...otherRaw.split(',').map((s) => s.trim()).filter(Boolean)];
      // Every original entry still present (order-independent).
      for (const orig of saved) expect(rejoined).toContain(orig);
      expect(rejoined.length).toBe(saved.length);
    });
  }

  it('exact checkbox values land in `known`, free text in `other`', () => {
    const { known, otherRaw } = splitCertifications(['8(a)', 'WOSB certified by U.S. SBA']);
    expect(known).toEqual(['8(a)']);
    expect(otherRaw).toBe('WOSB certified by U.S. SBA');
  });

  it('is case-insensitive on checkbox values', () => {
    expect(splitCertifications(['small business']).known).toEqual(['small business']);
    expect(splitCertifications(['SMALL BUSINESS']).known).toEqual(['SMALL BUSINESS']);
  });

  it('handles null / empty', () => {
    expect(splitCertifications(null).known).toEqual([]);
    expect(splitCertifications(undefined).otherRaw).toBe('');
    expect(splitCertifications([]).known).toEqual([]);
  });
});

describe('checkbox values are what the normalizer recognizes', () => {
  // The whole point: what a user CLICKS must produce a real set-aside code.
  const CHECKBOX_SET_ASIDES = [
    'Small Business', '8(a)', 'HUBZone', 'WOSB', 'EDWOSB',
    'SDVOSB', 'VOSB', 'SDB', 'Tribal 8(a)',
  ];
  for (const v of CHECKBOX_SET_ASIDES) {
    it(`"${v}" normalizes to at least one set-aside code`, () => {
      expect(normalizeCertifications([v]).setAsides.length).toBeGreaterThan(0);
    });
  }

  const CHECKBOX_CREDENTIALS = ['FCL', 'CMMC', 'ISO 9001', 'ISO 27001', 'SOC 2', 'CMMI'];
  for (const v of CHECKBOX_CREDENTIALS) {
    it(`"${v}" is a credential, NOT a set-aside`, () => {
      const r = normalizeCertifications([v]);
      expect(r.credentials.length).toBeGreaterThan(0);
      expect(r.setAsides).toEqual([]);
    });
  }
});
