import { describe, expect, it } from 'vitest';
import {
  activityFor,
  classifyOpportunities,
  filterRelevantOpportunities,
  isRelevantOpportunity,
  naicsSector,
} from './relevance';

/** Tier for one item under a resolution — the sharper contract after 2026-09-21. */
function tierOf(it: SamSearchItem, r: ResolvedBusiness) {
  const codes = r.naicsCodes.status === 'known' ? r.naicsCodes.items : [];
  return classifyOpportunities([it], { activity: activityFor(r), codes }).evidence[0].evidence.tier;
}
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

  it('admits 238220 when coverage dollar-leads 236220 (same sector, not peak-only identity)', () => {
    const r = resolution({
      primaryNaics: null,
      naicsCodes: { status: 'known', items: ['236220', '238220', '541512'] },
    });
    expect(isRelevantOpportunity(item({ naics: '238220', title: 'HVAC maintenance Building 12' }), r)).toBe(true);
  });

  it('admits 336612 when coverage dollar-leads 336611 (patrol-boat sibling)', () => {
    const r = resolution({
      original: 'I manufacture patrol boats',
      searchKeyword: 'patrol boats',
      coverageKeyword: 'patrol boats',
      keywords: { status: 'known', items: ['patrol', 'boats'] },
      naicsCodes: { status: 'known', items: ['336611', '336612'] },
      primaryNaics: null,
    });
    expect(
      isRelevantOpportunity(
        item({ title: 'PATROL BOAT CONSTRUCTION PSC 1940', naics: '336612', solicitation: 'PB-1' }),
        r,
      ),
    ).toBe(true);
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
    const r = resolution({ primaryNaics: null });
    expect(naicsSector('541512')).toBe('54');
    // CHANGED 2026-09-21: code overlap alone can no longer produce a DESCRIBED
    // match ("broad or incorrectly resolved codes can still produce false
    // matches"). 541512 is in the coverage set, so the listing is still shown
    // — under the explicitly-broader heading, never "matches what you
    // described". That distinction is the fix; silently deleting it is not.
    expect(tierOf(item({ title: 'Cybersecurity support', naics: '541512' }), r)).toBe('broader');
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
    // CHANGED 2026-09-21 (adversarial pass): "Door" and "doors" are the SAME
    // WORD — plural is inflection, not derivation. Treating them as different
    // printed "Mindy found 0 current opportunities" above three live fence
    // cards. So car doors vs building doors is a SENSE problem, not a stemming
    // one, and it is resolved where the evidence is: across the result set, by
    // sector disagreement. In isolation there is nothing to disagree with.
    const doorSet = [
      item({ title: 'Replace Garage Doors', naics: '238290', solicitation: 'D1' }),
      item({ title: 'Repair Operating Room Doors', naics: '238290', solicitation: 'D2' }),
      item({ title: 'Automobile Door Assemblies', naics: '336111', solicitation: 'D3' }),
    ];
    const byId = new Map(
      classifyOpportunities(doorSet, {
        activity: activityFor(r),
        codes: r.naicsCodes.status === 'known' ? r.naicsCodes.items : [],
      }).evidence.map((e) => [e.item.solicitation, e.evidence.tier]),
    );
    expect(byId.get('D1')).toBe('direct');
    expect(byId.get('D2')).toBe('direct');
    expect(byId.get('D3')).toBe('broader');
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
    // CHANGED 2026-09-21: ROAD-1 ("Repair A Avenue at Building 300") is road
    // work. The old gate kept it because 237310 shares NAICS sector 23 with
    // the HVAC coverage set — sector agreement, not evidence. HVAC-1 survives
    // on an exact code match, as adjacent evidence.
    expect(kept.map((i) => i.solicitation)).toEqual(['HVAC-1']);
    expect(kept.some((i) => /Dale Carnegie/i.test(i.title || ''))).toBe(false);
  });
});
