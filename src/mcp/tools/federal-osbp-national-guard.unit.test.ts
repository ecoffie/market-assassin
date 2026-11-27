/**
 * lookup_federal_osbp("National Guard Bureau") returned the U.S. Coast Guard's OSDBU (Eric's Claude + Mindy EFS Digital
 * run, 2026-11-25). FILLER strips "National" and "Bureau", so the query reduced to "GUARD" and the phrase rule found it
 * inside "COAST GUARD". The directory does not hold the National Guard Bureau: the honest answer is not_in_directory.
 */
import { describe, it, expect } from 'vitest';
import { lookupFederalOsbp } from './federal-osbp';
import { queryIdentifiesCandidate } from '@/lib/gov-contacts/agency-identity';

describe('a named designator must match', () => {
  it('National Guard Bureau / Army National Guard / Air National Guard never resolve to the Coast Guard', () => {
    for (const a of ['National Guard Bureau', 'Army National Guard', 'Air National Guard', 'the National Guard']) {
      const r = lookupFederalOsbp({ agency: a });
      expect(r.office?.abbreviation, a).not.toBe('USCG');
      expect(r._meta.coverage, a).toBe('not_in_directory');
      expect(r._meta.grounded, a).toBe(false);
    }
  });
  it('the Coast Guard still resolves by its own names', () => {
    for (const a of ['Coast Guard', 'U.S. Coast Guard', 'United States Coast Guard', 'USCG']) {
      expect(lookupFederalOsbp({ agency: a }).office?.abbreviation, a).toBe('USCG');
    }
  });
  it('the phrase rule still works when designators agree or are absent', () => {
    expect(queryIdentifiesCandidate('Navy', 'Department of the Navy')).toBe(true);
    expect(queryIdentifiesCandidate('Small Business Administration', 'U.S. Small Business Administration')).toBe(true);
    expect(queryIdentifiesCandidate('Bureau of Prisons', 'Federal Bureau of Prisons')).toBe(true);
    expect(queryIdentifiesCandidate('National Guard Bureau', 'U.S. Coast Guard')).toBe(false);
    expect(queryIdentifiesCandidate('Federal Guard', 'U.S. Coast Guard')).toBe(false);
  });
});
