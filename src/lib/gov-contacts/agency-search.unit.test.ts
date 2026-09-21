import { describe, it, expect } from 'vitest';
import { agencyKeyword, agencySearchKeywords } from './agency-search';

describe('agencyKeyword', () => {
  it('reduces a full agency name to its distinctive lead token', () => {
    expect(agencyKeyword('Department of Agriculture')).toBe('Agriculture');
    expect(agencyKeyword('Department of the Interior')).toBe('Interior');
    expect(agencyKeyword('Department of Commerce')).toBe('Commerce');
  });
  it('collapses multi-word names to a token that IS a substring of the stored value', () => {
    // stored as "HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF" — "Housing" matches
    expect(agencyKeyword('Department of Housing and Urban Development')).toBe('Housing');
    // stored as "HEALTH AND HUMAN SERVICES, DEPARTMENT OF" — "Health" matches
    expect(agencyKeyword('Department of Health and Human Services')).toBe('Health');
  });
  it('drops parenthetical abbreviations', () => {
    expect(agencyKeyword('Veterans Health Administration (VHA)')).toBe('Veterans');
  });
});

describe('agencySearchKeywords', () => {
  it('resolves the USDA acronym to the Agriculture department keyword', () => {
    expect(agencySearchKeywords('usda')).toContain('Agriculture');
  });
  it('resolves a sub-agency acronym to its PARENT department', () => {
    expect(agencySearchKeywords('USFS')).toContain('Agriculture'); // Forest Service → Agriculture
  });
  it('resolves a spelled-out sub-agency phrase to the parent department', () => {
    expect(agencySearchKeywords('forest service')).toContain('Agriculture');
    expect(agencySearchKeywords('land management')).toContain('Interior');
  });
  it('leaves an ordinary word (a person NAMED Forest) as a pure name search', () => {
    expect(agencySearchKeywords('forest')).toEqual([]);
    expect(agencySearchKeywords('smith')).toEqual([]);
  });
  it('is case-insensitive and ignores too-short input', () => {
    expect(agencySearchKeywords('HUD')).toContain('Housing');
    expect(agencySearchKeywords('a')).toEqual([]);
  });
});
