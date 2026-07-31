import { describe, it, expect } from 'vitest';
import { normalizeCertifications, eligibleSetAsides, resolveEligibleSetAsides } from './certifications';

describe('normalizeCertifications — every REAL prod value (2026-07-31)', () => {
  const cases: Array<[string, string[]]> = [
    ['WOSB', ['WOSB', 'SB-Total']],
    ['EDWOSB', ['EDWOSB', 'SB-Total']],
    ['8(a)', ['8(a)', 'SB-Total']],
    ['SDVOSB', ['SDVOSB', 'SB-Total']],
    ['VOSB', ['VOSB', 'SB-Total']],
    ['HUBZone', ['HUBZone', 'SB-Total']],
    ['Small Business', ['SB-Total']],
    ['SMALL BUSINESS', ['SB-Total']],
    ['SBE', ['SB-Total']],
    ['SDB', ['SB-Total']],
    ['Small Disadvantaged Business', ['SB-Total']],
    ['SBA Tribal 8(a)', ['Indian-SB', '8(a)', 'SB-Total']],
    ['WOSB certified by U.S. SBA', ['WOSB', 'SB-Total']],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected.join('+')}`, () => {
      const r = normalizeCertifications([input]);
      expect(r.setAsides.sort()).toEqual(expected.sort());
    });
  }

  it('splits multi-cert entries users cram into one field', () => {
    expect(normalizeCertifications(['SDVOSB;VOSB;WOSB']).setAsides.sort())
      .toEqual(['SB-Total', 'SDVOSB', 'VOSB', 'WOSB'].sort());
    expect(normalizeCertifications(['SDVOSB.WOSB']).setAsides.sort())
      .toEqual(['SB-Total', 'SDVOSB', 'WOSB'].sort());
  });

  it('EDWOSB does not collapse into plain WOSB (specific pattern wins)', () => {
    expect(normalizeCertifications(['EDWOSB']).setAsides).toContain('EDWOSB');
    expect(normalizeCertifications(['EDWOSB']).setAsides).not.toContain('WOSB');
  });

  it('SDVOSB does not collapse into plain VOSB', () => {
    expect(normalizeCertifications(['SDVOSB']).setAsides).toContain('SDVOSB');
    expect(normalizeCertifications(['SDVOSB']).setAsides).not.toContain('VOSB');
  });
});

describe('non-set-aside credentials are NOT claimed as eligibility', () => {
  it('state/city MWBE is not a federal set-aside', () => {
    const r = normalizeCertifications(['M/WBE certified by SBA of NYC', 'MBE', 'WBE']);
    expect(r.setAsides).toEqual([]);          // <- the important assertion
    expect(r.credentials).toContain('STATE-MWBE');
  });
  it('ISO / SOC2 / FCL are credentials, not set-asides', () => {
    const r = normalizeCertifications(['ISO 27001 aligned', 'SOC 2 Type II', 'Active Secret Facility Clearance (FCL)']);
    expect(r.setAsides).toEqual([]);
    expect(r.credentials.sort()).toEqual(['FCL', 'ISO', 'SOC2'].sort());
  });
});

describe('junk is surfaced, never guessed', () => {
  it('keeps unrecognized text instead of inventing eligibility', () => {
    const r = normalizeCertifications(['NO', 'Small Business Florida Certified General Contractor (CGC1540142)']);
    expect(r.unrecognized.length).toBeGreaterThan(0);
  });
  it('handles empty / non-array / non-string input', () => {
    for (const bad of [null, undefined, 'nope', [], [null, 42, '']]) {
      expect(() => normalizeCertifications(bad as unknown)).not.toThrow();
    }
    expect(normalizeCertifications([]).setAsides).toEqual([]);
  });
});

describe('eligibleSetAsides', () => {
  it('always includes Full & Open — certs only ADD lanes', () => {
    expect(eligibleSetAsides([])).toEqual(['Full & Open']);
    expect(eligibleSetAsides(['8(a)'])).toContain('Full & Open');
    expect(eligibleSetAsides(['8(a)'])).toContain('8(a)');
  });
});

describe('resolveEligibleSetAsides — vault first, business_type fallback', () => {
  it('prefers the Vault when it has certs', () => {
    const r = resolveEligibleSetAsides(['8(a)', 'WOSB'], 'Small Business');
    expect(r.source).toBe('vault');
    expect(r.codes).toEqual(expect.arrayContaining(['8(a)', 'WOSB']));
  });

  // The 752 users who told us at onboarding and never filled the Vault.
  const REAL_BUSINESS_TYPES: Array<[string, string]> = [
    ['SDVOSB', 'SDVOSB'],          // 321 users
    ['Small Business', 'SB-Total'], // 283
    ['small-business', 'SB-Total'], // 53
    ['WOSB', 'WOSB'],               // 48
    ['8a', '8(a)'],                 // 16
    ['women-owned', 'WOSB'],        // 14
    ['VOSB', 'VOSB'],               // 8
    ['HUBZone', 'HUBZone'],         // 4
    ['EDWOSB', 'EDWOSB'],           // 2
    ['hubzone', 'HUBZone'],         // 1
  ];
  for (const [bt, expected] of REAL_BUSINESS_TYPES) {
    it(`falls back on business_type "${bt}" -> ${expected}`, () => {
      const r = resolveEligibleSetAsides([], bt);
      expect(r.source).toBe('business_type');
      expect(r.codes).toContain(expected);
    });
  }

  it('junk business_type yields none — never a guessed lane', () => {
    // 'dot-certified' is a real value in the DB and is not a set-aside.
    const r = resolveEligibleSetAsides([], 'dot-certified');
    expect(r.source).toBe('none');
    expect(r.codes).toEqual([]);
  });

  it('nothing anywhere = none (callers must read this as do-not-filter)', () => {
    expect(resolveEligibleSetAsides([], null).source).toBe('none');
    expect(resolveEligibleSetAsides(null, '').codes).toEqual([]);
  });

  it('ISO/FCL-only Vault falls through to business_type rather than claiming a lane', () => {
    const r = resolveEligibleSetAsides(['ISO 27001', 'FCL'], 'WOSB');
    expect(r.source).toBe('business_type');
    expect(r.codes).toContain('WOSB');
  });
});
