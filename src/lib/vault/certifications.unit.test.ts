import { describe, it, expect } from 'vitest';
import { normalizeCertifications, eligibleSetAsides } from './certifications';

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
