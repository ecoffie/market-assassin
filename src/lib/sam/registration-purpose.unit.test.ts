/**
 * SAM registration purpose honesty (2026-11-23, RBA Engineering C9K6EE9JVDK7): production
 * returned purposeOfRegistration "Federal Assistance Awards" + a placeholder NAICS row
 * {naicsCode:""} and nobody told the customer the registration is assistance-only.
 */
import { describe, it, expect } from 'vitest';
import { transformEntity } from './entity-api';
import { registrationPurposeReadiness, isAssistanceOnly } from './registration-purpose';

/** Shape of the live SAM v3 record for an assistance-only (Z1) registrant. */
function z1Raw(overrides: Record<string, unknown> = {}) {
  return {
    entityRegistration: {
      ueiSAM: 'C9K6EE9JVDK7',
      cageCode: null,
      legalBusinessName: 'RBA ENGINEERING INTERNATIONAL PLLC',
      registrationStatus: 'Active',
      purposeOfRegistrationCode: 'Z1',
      purposeOfRegistrationDesc: 'Federal Assistance Awards',
      ...overrides,
    },
    coreData: {},
    assertions: {
      goodsAndServices: {
        primaryNaics: null,
        naicsList: [{ naicsCode: null, naicsDescription: null, sbaSmallBusiness: null, naicsException: null }],
        pscList: [],
      },
    },
  };
}

describe('transformEntity — purpose + placeholder NAICS', () => {
  it('parses purposeOfRegistrationCode alongside the description', () => {
    const e = transformEntity(z1Raw());
    expect(e.purposeOfRegistrationCode).toBe('Z1');
    expect(e.purposeOfRegistration).toBe('Federal Assistance Awards');
  });

  it('drops the placeholder NAICS row — never emits naicsCode ""', () => {
    const e = transformEntity(z1Raw());
    expect(e.naicsList).toEqual([]);
    expect(e.certifications?.naicsSmallBusiness).toEqual({});
  });

  it('drops blank-string NAICS rows but keeps real ones', () => {
    const raw = z1Raw({ purposeOfRegistrationCode: 'Z2', purposeOfRegistrationDesc: 'All Awards' });
    (raw.assertions.goodsAndServices as Record<string, unknown>).primaryNaics = '541330';
    (raw.assertions.goodsAndServices as Record<string, unknown>).naicsList = [
      { naicsCode: '  ', naicsDescription: '' },
      { naicsCode: '541330', naicsDescription: 'Engineering Services', sbaSmallBusiness: 'Y' },
    ];
    const e = transformEntity(raw);
    expect(e.naicsList?.map((n) => n.naicsCode)).toEqual(['541330']);
    expect(e.naicsList?.[0].isPrimary).toBe(true);
    expect(e.naicsList?.every((n) => n.naicsCode !== '')).toBe(true);
  });

  it('omits the code key when SAM did not send it (absent, not "")', () => {
    const e = transformEntity(z1Raw({ purposeOfRegistrationCode: undefined, purposeOfRegistrationDesc: undefined }));
    expect('purposeOfRegistrationCode' in e).toBe(false);
    expect(e.purposeOfRegistration).toBeUndefined();
  });
});

describe('registrationPurposeReadiness', () => {
  it('Z1 → not registered for contract awards, warning cites the field + FAR 4.1102(a)', () => {
    const r = registrationPurposeReadiness('Z1', 'Federal Assistance Awards');
    expect(r.contract_awards).toBe('not_registered');
    expect(isAssistanceOnly(r)).toBe(true);
    expect(r.warning).toContain('Federal Assistance Awards only (purposeOfRegistrationCode Z1)');
    expect(r.warning).toContain('not registered for contract awards');
    expect(r.warning).toContain('FAR 4.1102(a)');
    expect(r.note).toBeUndefined();
  });

  it('Z2 → registered, no warning', () => {
    const r = registrationPurposeReadiness('Z2', 'All Awards');
    expect(r.contract_awards).toBe('registered');
    expect(r.warning).toBeUndefined();
    expect(r.note).toBeUndefined();
  });

  it('absent → unknown, no warning, says unknown', () => {
    const r = registrationPurposeReadiness(undefined, undefined);
    expect(r).toMatchObject({ purpose_code: null, purpose_description: null, contract_awards: 'unknown' });
    expect(r.warning).toBeUndefined();
    expect(r.note).toMatch(/unknown/);
  });

  it('description only (no code) still decides when SAM wording is explicit', () => {
    expect(registrationPurposeReadiness(null, 'Federal Assistance Awards').contract_awards).toBe('not_registered');
    expect(registrationPurposeReadiness(null, 'Federal Assistance Awards').warning).toContain('purposeOfRegistrationDesc');
    expect(registrationPurposeReadiness(null, 'All Awards').contract_awards).toBe('registered');
  });

  it('an uninterpreted code is unknown — never guessed', () => {
    const r = registrationPurposeReadiness('Z3', 'IGT-Only');
    expect(r.contract_awards).toBe('unknown');
    expect(r.warning).toBeUndefined();
    expect(r.note).toContain('Z3');
  });
});
