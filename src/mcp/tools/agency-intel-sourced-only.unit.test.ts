/**
 * get_agency_intel returns ONLY cited GAO / Inspector General findings (Ask Mindy Backend Spec, Nov 21 2026:
 * "Return only sourced GAO and Inspector General items, with report number and date").
 *
 * The defect this guards: `painPoints` (the display list a host quotes) was taken from the legacy static
 * file whenever the agency had any legacy strings, even when cited findings existed, so an unsourced line
 * could be presented as the buyer's pain point while the real citation sat in painPointCitations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  resolvedPainPoints: [] as string[],
  bundle: null as null | Record<string, unknown>,
  throwSourced: false,
}));

vi.mock('@/lib/agency-hierarchy/unified-search', () => ({
  getAgency: vi.fn(async () => ({
    name: 'United States Coast Guard', shortName: 'USCG', cgacCode: '070', fpdsCodes: [], parent: 'Department of Homeland Security',
    parentPath: 'DHS > USCG', level: 'agency', children: [], painPoints: state.resolvedPainPoints, priorities: [],
    relatedContractors: [], matchType: 'exact', matchScore: 100, sources: ['directory'],
  })),
}));
vi.mock('@/lib/strategic-intel/sourced-pain-points', async (orig) => {
  const actual = await orig<typeof import('@/lib/strategic-intel/sourced-pain-points')>();
  return {
    ...actual,
    getAgencySourcedIntelligence: vi.fn(async () => {
      if (state.throwSourced) throw new Error('reader down');
      return state.bundle;
    }),
  };
});
vi.mock('@/lib/usaspending/agency-spending-detail', () => ({
  getAgencySpendingDetail: vi.fn(async () => ({ degraded: false, spending: { scope: 'REQUESTED', scope_name: 'USCG', totalObligations: 0 } })),
}));
vi.mock('@/lib/strategic-intel/legislative-evidence', () => ({
  getLegislativeEvidenceForAgency: vi.fn(async () => ({ status: 'not_held', vehicles: [], other_measures: [] })),
}));
vi.mock('@/lib/budget-intel/read', () => ({ readIncreasingPrograms: vi.fn(async () => null) }));

const { getAgencyIntel } = await import('./agency-intel');

const cited = {
  agency: 'Coast Guard', pain_point: 'Coast Guard cutter maintenance backlog is delaying patrols',
  source_type: 'gao_report', source_url: 'https://www.gao.gov/products/gao-25-106544', document_number: 'GAO-25-106544',
  published_at: '2025-04-10', institute_source_id: 'inst-1', provenance: 'SOURCE_FACT', legacy_source_tag: null,
};
const uncitedInterpretation = { ...cited, pain_point: 'Derived: shipyard capacity is the binding constraint', institute_source_id: null, provenance: 'MINDY_INTERPRETATION' };
const legacy = {
  agency: 'Coast Guard', pain_point: 'Aging fleet needs $2B modernization', source_type: 'legacy_json', source_url: null,
  document_number: null, published_at: null, institute_source_id: null, provenance: 'LEGACY_MANUAL', legacy_source_tag: '(Source: GAO)',
};
const bundleOf = (painPoints: unknown[], failed = false) => ({
  agency: 'USCG', canonicalAgency: 'Coast Guard', sourced: painPoints.filter((p) => (p as { provenance: string }).provenance !== 'LEGACY_MANUAL'),
  legacy: painPoints.filter((p) => (p as { provenance: string }).provenance === 'LEGACY_MANUAL'), painPoints, priorities: [],
  meta: {
    sourcedCount: painPoints.filter((p) => (p as { provenance: string }).provenance !== 'LEGACY_MANUAL').length,
    legacyCount: painPoints.filter((p) => (p as { provenance: string }).provenance === 'LEGACY_MANUAL').length,
    legacyPriorityCount: 0, provenanceAvailable: painPoints.some((p) => (p as { provenance: string }).provenance === 'SOURCE_FACT'),
    priorityBasis: 'static_file', sourcedReadFailed: failed,
  },
});

beforeEach(() => { state.resolvedPainPoints = []; state.bundle = null; state.throwSourced = false; });

describe('only cited GAO / IG findings are returned', () => {
  it('legacy file strings never replace cited findings in painPoints', async () => {
    state.resolvedPainPoints = ['Aging fleet needs $2B modernization (Source: GAO)'];
    state.bundle = bundleOf([cited, legacy]);
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r.agency!.painPoints).toEqual(['Coast Guard cutter maintenance backlog is delaying patrols (Source: GAO-25-106544)']);
    expect(r.agency!.painPointCitations).toHaveLength(1);
    expect(r.agency!.painPointCitations[0]).toMatchObject({ document_number: 'GAO-25-106544', published_at: '2025-04-10', source_url: cited.source_url });
    expect(r._meta).toMatchObject({ sourced_pain_points: 1, withheld_unsourced_pain_points: 1 });
    expect(r.agency!.provenanceNote).toMatch(/1 cited finding.*1 unsourced claim\(s\) withheld/);
  });

  it('an interpretation without a citation is withheld, not shown as a finding', async () => {
    state.bundle = bundleOf([cited, uncitedInterpretation]);
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r.agency!.painPointCitations.map((c) => c.provenance)).toEqual(['SOURCE_FACT']);
    expect(r._meta.withheld_unsourced_pain_points).toBe(1);
  });

  it('an agency with only legacy claims returns no pain point, and says not to state one', async () => {
    state.resolvedPainPoints = ['Aging fleet needs $2B modernization (Source: GAO)'];
    state.bundle = bundleOf([legacy]);
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r.agency!.painPoints).toEqual([]);
    expect(r.agency!.painPointCitations).toEqual([]);
    expect(r.agency!.hasSourcedIntelligence).toBe(false);
    expect(r._meta.withheld_unsourced_pain_points).toBe(1);
    expect(r.agency!.provenanceNote).toMatch(/No cited GAO or Inspector General finding.*Do not state a pain point/);
  });

  it('legacy file strings with an empty bundle are counted as withheld', async () => {
    state.resolvedPainPoints = ['A', 'B'];
    state.bundle = bundleOf([]);
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r.agency!.painPoints).toEqual([]);
    expect(r._meta.withheld_unsourced_pain_points).toBe(2);
  });
});

describe('a failed reader is unavailable, never legacy text', () => {
  it('the bundle reports a failed living read → degraded, no pain points', async () => {
    state.resolvedPainPoints = ['Aging fleet needs $2B modernization (Source: GAO)'];
    state.bundle = bundleOf([legacy], true);
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r._meta.degraded).toBe(true);
    expect(r.agency!.painPoints).toEqual([]);
    expect(r.agency!.provenanceNote).toMatch(/unavailable for this call \(not none\)/);
  });

  it('the reader throws → degraded, no pain points (the legacy strings are not served)', async () => {
    state.resolvedPainPoints = ['Aging fleet needs $2B modernization (Source: GAO)'];
    state.throwSourced = true;
    const r = await getAgencyIntel({ agency: 'USCG' });
    expect(r._meta.degraded).toBe(true);
    expect(r.agency!.painPoints).toEqual([]);
  });
});
