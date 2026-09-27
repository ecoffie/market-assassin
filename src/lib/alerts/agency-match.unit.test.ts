import { describe, it, expect } from 'vitest';
import { matchProfileAgencies, normalizeOrgName } from './agency-match';

// Department / sub-tier strings are SAM's own spellings, copied from live notices.
describe('matchProfileAgencies — anchored identity, never substring', () => {
  it('NIST does not match "…ADMINISTRATION" (FDA, FHWA)', () => {
    expect(matchProfileAgencies(['NIST'], 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF', 'FOOD AND DRUG ADMINISTRATION')).toEqual([]);
    expect(matchProfileAgencies(['NIST'], 'TRANSPORTATION, DEPARTMENT OF', 'FEDERAL HIGHWAY ADMINISTRATION')).toEqual([]);
  });

  it('NIST matches the National Institute of Standards and Technology', () => {
    expect(matchProfileAgencies(['NIST'], 'COMMERCE, DEPARTMENT OF', 'NATIONAL INSTITUTE OF STANDARDS AND TECHNOLOGY')).toEqual(['NIST']);
  });

  it('VA matches "VETERANS AFFAIRS, DEPARTMENT OF"', () => {
    expect(matchProfileAgencies(['VA'], 'VETERANS AFFAIRS, DEPARTMENT OF', 'VETERANS AFFAIRS, DEPARTMENT OF')).toEqual(['VA']);
  });

  it('VA does not match the Navy ("na-VA-l") or anything else containing "va"', () => {
    expect(matchProfileAgencies(['VA'], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual([]);
    expect(matchProfileAgencies(['VA'], 'DEPT OF DEFENSE', 'NAVAL SEA SYSTEMS COMMAND')).toEqual([]);
  });

  it('State matches the Department of State, not "UNITED STATES …"', () => {
    expect(matchProfileAgencies(['State'], 'STATE, DEPARTMENT OF', 'STATE, DEPARTMENT OF')).toEqual(['State']);
    expect(matchProfileAgencies(['State'], 'AGRICULTURE, DEPARTMENT OF', 'UNITED STATES FOREST SERVICE')).toEqual([]);
  });

  it('a sub-agency matches its own sub-tier only; the parent matches all of its components', () => {
    expect(matchProfileAgencies(['Navy'], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual(['Navy']);
    expect(matchProfileAgencies(['Army'], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual([]);
    expect(matchProfileAgencies(['DOD'], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual(['DOD']);
    expect(matchProfileAgencies(['DOT'], 'TRANSPORTATION, DEPARTMENT OF', 'FEDERAL HIGHWAY ADMINISTRATION')).toEqual(['DOT']);
    expect(matchProfileAgencies(['FAA'], 'TRANSPORTATION, DEPARTMENT OF', 'FEDERAL HIGHWAY ADMINISTRATION')).toEqual([]);
    expect(matchProfileAgencies(['FAA'], 'TRANSPORTATION, DEPARTMENT OF', 'FEDERAL AVIATION ADMINISTRATION')).toEqual(['FAA']);
  });

  it('a spelled-out name matches its department', () => {
    expect(matchProfileAgencies(['Commerce'], 'COMMERCE, DEPARTMENT OF', 'US PATENT AND TRADEMARK OFFICE')).toEqual(['Commerce']);
  });

  it('an unknown term matches nothing rather than guessing', () => {
    expect(matchProfileAgencies(['ZZTOP'], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual([]);
    expect(matchProfileAgencies([], 'DEPT OF DEFENSE', 'DEPT OF THE NAVY')).toEqual([]);
  });
});

describe('normalizeOrgName', () => {
  it('strips the "Department of (the)" wrapper in both SAM spellings', () => {
    expect(normalizeOrgName('DEPT OF THE NAVY')).toBe('NAVY');
    expect(normalizeOrgName('Department of the Navy')).toBe('NAVY');
    expect(normalizeOrgName('COMMERCE, DEPARTMENT OF')).toBe('COMMERCE');
    expect(normalizeOrgName('Federal Railroad Administration (FRA)')).toBe('FEDERAL RAILROAD ADMINISTRATION');
  });
});
