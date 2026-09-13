import { describe, expect, it } from 'vitest';
import { filterRelevantOpportunities, isRelevantOpportunity, naicsSector } from './relevance';
import type { ResolvedBusiness, SamSearchItem } from './types';

function resolution(over: Partial<ResolvedBusiness> = {}): ResolvedBusiness {
  return {
    original: 'I install HVAC in buildings',
    followUpUsed: null,
    state: 'structured',
    searchKeyword: 'hvac',
    contextLabel: null,
    keywords: { status: 'known', items: ['hvac', 'air handling'] },
    naicsCodes: { status: 'known', items: ['238220', '236220', '541512'] },
    primaryNaics: '238220',
    psc: null,
    coverageKeyword: 'hvac',
    confidence: 'high',
    followUpPrompt: null,
    provenance: {},
    ...over,
  };
}

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    title: 'Replace Air Handling Units',
    agency: 'VA',
    naics: '238220',
    set_aside: null,
    type: 'Solicitation',
    deadline: '2026-09-16T21:00:00Z',
    solicitation: 'SOL-1',
    link: 'https://sam.gov/opp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view',
    ...over,
  };
}

describe('isRelevantOpportunity', () => {
  it('keeps facility/HVAC/construction NAICS in the primary sector', () => {
    const r = resolution();
    expect(isRelevantOpportunity(item({ naics: '238220', title: 'Replace HVAC' }), r)).toBe(true);
    expect(isRelevantOpportunity(item({ naics: '236220', title: 'Repair A Avenue at Building 300' }), r)).toBe(
      true,
    );
  });

  it('drops the Dale Carnegie training contract that only matched Building', () => {
    const r = resolution();
    expect(
      isRelevantOpportunity(
        item({
          title: 'Dale Carnegie Building a Stronger and More Cohesive Team Training on Fort Drum, NY',
          naics: '611430',
          solicitation: 'W911S226QA089',
        }),
        r,
      ),
    ).toBe(false);
  });

  it('does not let a dirty coverage IT code admit an IT listing into an HVAC market', () => {
    const r = resolution();
    expect(naicsSector('541512')).toBe('54');
    expect(isRelevantOpportunity(item({ title: 'Cybersecurity support', naics: '541512' }), r)).toBe(false);
  });

  it('does not keep automobile doors just because coverage said door repair', () => {
    const r = resolution({
      original: 'fix doors',
      searchKeyword: 'door repair',
      coverageKeyword: 'door repair',
      keywords: { status: 'known', items: ['door repair', 'doors'] },
      naicsCodes: { status: 'known', items: ['236220', '238290'] },
      primaryNaics: '236220',
    });
    expect(
      isRelevantOpportunity(item({ title: 'Automobile Door Assemblies', naics: '336111' }), r),
    ).toBe(false);
    expect(isRelevantOpportunity(item({ title: 'Replace Garage Doors', naics: '238290' }), r)).toBe(true);
  });

  it('drops uncoded keyword hits when a structured NAICS market exists', () => {
    expect(isRelevantOpportunity(item({ naics: null, title: 'Building a team' }), resolution())).toBe(false);
  });

  it('keeps a lidar surveying listing when coverage led with aircraft manufacturing', () => {
    const r = resolution({
      original: 'work with lidar for uas drones',
      searchKeyword: 'drones',
      coverageKeyword: 'drones',
      keywords: { status: 'known', items: ['drones', 'unmanned aircraft'] },
      naicsCodes: { status: 'known', items: ['336411', '336413', '336414'] },
      primaryNaics: '336411',
    });
    expect(
      isRelevantOpportunity(
        item({
          title: 'WESTERN MINES LIDAR SURVEY',
          naics: '541370',
          solicitation: 'LIDAR-1',
        }),
        r,
      ),
    ).toBe(true);
    expect(
      isRelevantOpportunity(
        item({
          title: 'UAS LIDAR YELLOWSCAN MAPPER ULTRA',
          naics: '334511',
          solicitation: 'LIDAR-2',
        }),
        r,
      ),
    ).toBe(true);
  });

  it('on keyword fallback, requires a distinctive token — not a bare Building homonym', () => {
    const r = resolution({
      state: 'keyword_fallback',
      primaryNaics: null,
      naicsCodes: { status: 'known', items: [] },
      keywords: { status: 'known', items: ['hvac'] },
    });
    expect(isRelevantOpportunity(item({ naics: '611430', title: 'Building a Stronger Team' }), r)).toBe(false);
    expect(isRelevantOpportunity(item({ naics: '238220', title: 'Replace HVAC at Building 300' }), r)).toBe(true);
  });
});

describe('filterRelevantOpportunities', () => {
  it('removes Dale Carnegie from a mixed HVAC result set', () => {
    const kept = filterRelevantOpportunities(
      [
        item({ title: 'Replace Air Handling Units', naics: '238220', solicitation: 'HVAC-1' }),
        item({
          title: 'Dale Carnegie Building a Stronger and More Cohesive Team Training on Fort Drum, NY',
          naics: '611430',
          solicitation: 'W911S226QA089',
        }),
        item({ title: 'Repair A Avenue at Building 300', naics: '237310', solicitation: 'ROAD-1' }),
      ],
      resolution(),
    );
    expect(kept.map((i) => i.solicitation)).toEqual(['HVAC-1', 'ROAD-1']);
    expect(kept.some((i) => /Dale Carnegie/i.test(i.title || ''))).toBe(false);
  });
});
