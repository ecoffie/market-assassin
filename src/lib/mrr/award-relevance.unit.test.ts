import { describe, expect, it } from 'vitest';
import { awardRelevance, requirementTerms } from './award-relevance';

describe('buyer-history relevance: requested work vs other purchases by the same office', () => {
  const grounds = { requirement: 'Grounds maintenance and mowing', requiredNaics: '561730' };

  it('extracts distinctive requirement words, never generic ones', () => {
    expect(requirementTerms('Grounds maintenance and mowing')).toEqual(['grounds', 'mowing']);
    expect(requirementTerms('IT help desk support')).toEqual(['IT', 'help', 'desk']);
  });

  it('marks an award whose description names the work as relevant', () => {
    const r = awardRelevance({ ...grounds, description: 'GROUNDS MAINTENANCE SERVICES FORT BRAGG', awardNaics: '561730' });
    expect(r.basis).toBe('description');
    expect(r.label).toBe('Relevant: the award description mentions “grounds”; coded NAICS 561730.');
  });

  it('flags a code-only match whose description is about something else', () => {
    const r = awardRelevance({ ...grounds, description: 'CUSTODIAL SERVICES BLDG 2-1111', awardNaics: '561730' });
    expect(r.basis).toBe('code');
    expect(r.label).toMatch(/does not mention the requirement/);
  });

  it('labels a different purchase by the same office as such', () => {
    const r = awardRelevance({ ...grounds, description: 'OFFICE FURNITURE', awardNaics: '337214' });
    expect(r.basis).toBe('none');
    expect(r.label).toMatch(/Another purchase by this office/);
  });

  it('matches "IT" only as a whole word, never inside other words', () => {
    const help = { requirement: 'IT help desk support', requiredNaics: '541512' };
    expect(awardRelevance({ ...help, description: 'IT HELP DESK SUPPORT', awardNaics: '541519' }).basis).toBe('description');
    expect(awardRelevance({ ...help, description: 'SECURITY GUARD SERVICES', awardNaics: '561612' }).basis).toBe('none');
  });
});
