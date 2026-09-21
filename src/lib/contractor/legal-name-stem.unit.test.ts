import { describe, expect, it } from 'vitest';
import { legalNameIlikePattern, legalNameSearchStem, namesMatchLegalStem } from './legal-name-stem';

describe('legal name stem — comma and suffix must not split one firm', () => {
  it('TANAQ SUPPORT SERVICES, LLC and the no-comma form share a stem', () => {
    expect(legalNameSearchStem('TANAQ SUPPORT SERVICES, LLC').toLowerCase()).toBe(
      legalNameSearchStem('Tanaq Support Services LLC').toLowerCase(),
    );
    expect(legalNameSearchStem('TANAQ SUPPORT SERVICES, LLC')).toBe('TANAQ SUPPORT SERVICES');
  });

  it('Tanaq Global Solutions LLC matches the SAM row that keeps the comma', () => {
    expect(namesMatchLegalStem('Tanaq Global Solutions LLC', 'TANAQ GLOBAL SOLUTIONS, LLC')).toBe('exact');
    expect(legalNameIlikePattern('Tanaq Global Solutions LLC')).toBe('%Tanaq Global Solutions%');
  });

  it('a bare family token still contains every sibling', () => {
    expect(namesMatchLegalStem('Tanaq', 'TANAQ ENVIRONMENTAL, LLC')).toBe('contains');
    expect(namesMatchLegalStem('Tanaq', 'TANAQ')).toBe('exact');
  });

  it('does not rewrite ampersands — stored "&" would miss "and"', () => {
    expect(legalNameSearchStem('J & J MAINTENANCE INC')).toBe('J J MAINTENANCE');
  });
});
