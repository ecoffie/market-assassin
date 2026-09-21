/**
 * Block 2 done-test.
 *  - a valid fixture produces ONE deterministic normalized object;
 *  - missing required fields fail with FIELD-SPECIFIC errors;
 *  - blank optional codes stay UNKNOWN (absent) — never "" and never 0.
 */
import { describe, it, expect } from 'vitest';
import { normalizeRequirement, RequirementValidationError } from './normalizer';

/** The real DHA notice used for the end-to-end run (WEEKEND corrections item 8). */
const DHA = {
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  sub_agency: 'Department of Defense',
  naics: '541512',
  psc: 'DA01',
  keyword: 'medical modeling and simulation',
  description: 'The Defense Health Agency seeks joint medical planning, modeling and simulation capabilities.',
  solicitation_number: 'DHA_JOMIS_JMP_20260813',
  notice_id: '213a2fe3a447465e8f30699c9f056ec4',
};

describe('normalizeRequirement', () => {
  it('produces one deterministic normalized object for a valid fixture', () => {
    const a = normalizeRequirement(DHA);
    const b = normalizeRequirement(DHA);
    expect(a.normalized).toEqual(b.normalized);
    expect(JSON.stringify(a.normalized)).toBe(JSON.stringify(b.normalized));
    expect(a.normalized.naics).toBe('541512');
    expect(a.normalized.psc).toBe('DA01');
    expect(a.normalized.solicitation_number).toBe('DHA_JOMIS_JMP_20260813');
  });

  it('preserves the caller original alongside the normalized value', () => {
    const r = normalizeRequirement({ ...DHA, psc: ' da01 ' });
    expect(r.normalized.psc).toBe('DA01');
    expect(r.original.psc).toBe(' da01 ');
    expect(r.notes.join(' ')).toContain('psc normalized');
  });

  it('fails with FIELD-SPECIFIC errors when required fields are missing', () => {
    try {
      normalizeRequirement({ title: 'x' });
      throw new Error('expected validation to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RequirementValidationError);
      const errs = (e as RequirementValidationError).fieldErrors;
      expect(Object.keys(errs).sort()).toEqual(['agency', 'description', 'keyword']);
      expect(errs.agency).toMatch(/agency is required/);
    }
  });

  it('treats a whitespace-only required field as missing, not as a value', () => {
    expect(() => normalizeRequirement({ ...DHA, agency: '   ' })).toThrow(RequirementValidationError);
  });

  it('leaves blank optional codes UNKNOWN — never "" and never 0', () => {
    const r = normalizeRequirement({ ...DHA, naics: '', psc: undefined, est_value: '' });
    expect(r.normalized.naics).toBeUndefined();
    expect(r.normalized.psc).toBeUndefined();
    expect(r.normalized.est_value).toBeUndefined();
    expect('naics' in r.normalized).toBe(false);
    expect('est_value' in r.normalized).toBe(false);
    expect(r.notes.join(' ')).toContain('naics not supplied');
  });

  it('rejects a malformed NAICS instead of truncating it', () => {
    expect(() => normalizeRequirement({ ...DHA, naics: '5415123' })).toThrow(RequirementValidationError);
    expect(() => normalizeRequirement({ ...DHA, naics: 'abc' })).toThrow(RequirementValidationError);
  });

  it('rejects a malformed PSC and a malformed state instead of coercing', () => {
    expect(() => normalizeRequirement({ ...DHA, psc: 'DA0' })).toThrow(RequirementValidationError);
    expect(() => normalizeRequirement({ ...DHA, place_of_performance_state: 'Virginia' })).toThrow(
      RequirementValidationError,
    );
  });

  it('accepts a valid 2-letter state and normalizes case', () => {
    const r = normalizeRequirement({ ...DHA, place_of_performance_state: 'va' });
    expect(r.normalized.place_of_performance_state).toBe('VA');
  });

  it('keeps set_aside_hint as a hypothesis note, never as fact', () => {
    const r = normalizeRequirement({ ...DHA, set_aside_hint: 'Small Business' });
    expect(r.normalized.set_aside_hint).toBe('Small Business');
    expect(r.notes.join(' ')).toContain('HYPOTHESIS');
  });

  it('rejects a non-numeric or negative est_value rather than zeroing it', () => {
    expect(() => normalizeRequirement({ ...DHA, est_value: 'lots' })).toThrow(RequirementValidationError);
    expect(() => normalizeRequirement({ ...DHA, est_value: -5 })).toThrow(RequirementValidationError);
  });

  it('rejects an unparseable date rather than dropping it silently', () => {
    expect(() => normalizeRequirement({ ...DHA, pop: { start: 'not-a-date' } })).toThrow(RequirementValidationError);
  });
});
