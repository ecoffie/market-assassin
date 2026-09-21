/**
 * getBqContractorHistory — source + detail-cache completeness.
 * Mocks queryCached via ./cache (same pattern as recipient-profile-fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Q = { cacheKey: string; query: string; cacheOnly?: boolean };

const calls: Q[] = [];
let profileRows: unknown[] = [];
let detailByKey = new Map<string, unknown[]>();
let unavailableKeys = new Set<string>();

vi.mock('./cache', () => ({
  queryCached: vi.fn(async (opts: Q) => {
    calls.push(opts);
    if (opts.cacheKey.startsWith('recipient:by-uei:')) return profileRows;
    if (opts.cacheKey.includes('awards-fallback')) return [];
    return detailByKey.get(opts.cacheKey) ?? [];
  }),
  bqUnavailable: vi.fn((cacheKey: string, rowCount: number) => {
    // Mirror real semantics enough for this test: marked unavailable OR we treat
    // cacheOnly miss markers. Here we use an explicit set.
    void rowCount;
    return unavailableKeys.has(cacheKey);
  }),
}));

vi.mock('@/lib/sam/recipient-certs', () => ({
  getCachedCerts: vi.fn(async () => new Map()),
  certBuckets: () => [],
}));

vi.mock('@/lib/awards-ingest/read-warehouse-coverage', () => ({
  loadAwardsWarehouseCoverage: vi.fn(async () => ({
    clocks: {
      sourceActionMax: '2026-09-18',
      acquiredAt: '2026-09-20T18:16:56.112Z',
      mergedAt: '2026-09-20T18:18:56.743Z',
      recipientsRebuiltAt: '2026-09-20T18:19:35.838Z',
    },
    lastBuilt: '2026-09-20',
    freshness: { status: 'healthy', sourceAgeDays: 3, runAgeDays: 0 },
  })),
}));

const { getBqContractorHistory } = await import('./recipients');

const PROFILE = {
  recipient_uei: 'FCJCDUZV7RM3',
  recipient_name: 'NORTH STAR',
  total_obligated: 23_350_000,
  award_count: 35,
  last_action_date: '2025-06-15',
  first_action_date: '2019-01-01',
  city: null,
  state: 'AK',
  cage_code: null,
  distinct_agency_count: 2,
  distinct_naics_count: 1,
};

const AGENCY = [{ awarding_agency: 'DOD', total_amount: 23_350_000, pct_of_total: 1 }];
const NAICS = [{ naics_code: '541512', naics_description: 'IT', total_amount: 23_350_000, award_count: 35 }];
/** Adequate coverage for FY2025–FY2026 lookback when reference is FY2026. */
const YEARLY = [
  { fiscal_year: 2025, total_obligated: 10_000_000, positive_obligations: 10_000_000, deobligations: 0, award_count: 20 },
  { fiscal_year: 2026, total_obligated: 13_350_000, positive_obligations: 13_350_000, deobligations: 0, award_count: 15 },
];
const RECENT = [{
  award_id: 'A1', piid: 'P1', mod_number: '0', awarding_agency: 'DOD', awarding_office: null,
  naics_code: '541512', naics_description: null, description: 'Work',
  obligation_amount: 1000, action_date: '2025-01-01',
  pop_start_date: null, pop_end_date: null, pop_state: 'AK', set_aside: null,
}];
const SET_ASIDE = [{
  set_aside: '8(A) SOLE SOURCE',
  award_count: 2,
  last_action_fy: 2022,
  first_observed_positive_action_fy: 2019,
  total_obligated: 1_000_000,
  contributing_ueis: ['FCJCDUZV7RM3'],
  supporting_actions: [{
    uei: 'FCJCDUZV7RM3',
    award_id: 'A1',
    fiscal_year: 2022,
    obligation_amount: -50_000,
    action_date: '2022-03-01',
  }],
}];

function seedCompleteDetails(uei: string) {
  const k = `single:${uei}`;
  detailByKey.set(`rollup:${k}:yearly-totals:v3-m`, YEARLY);
  detailByKey.set(`rollup:${k}:top-agencies:8:v4-m`, AGENCY);
  detailByKey.set(`rollup:${k}:top-naics:8:v2-m`, NAICS);
  detailByKey.set(`rollup:${k}:recent-awards:25:v4-m`, RECENT);
  detailByKey.set(`rollup:${k}:yearly-by-agency:v2-m`, []);
  detailByKey.set(`rollup:${k}:set-aside-history:v4-m`, SET_ASIDE);
}

beforeEach(() => {
  calls.length = 0;
  profileRows = [];
  detailByKey = new Map();
  unavailableKeys = new Set();
});

describe('getBqContractorHistory — source + completeness', () => {
  it('warm complete cache → source bigquery_normalized + enrichment complete', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.source).toBe('bigquery_normalized');
    expect(h.source).not.toBe('usaspending_cache');
    expect(h.enrichment_status).toBe('complete');
    expect(h.partial).toBe(false);
    expect(h.summary.awardCount).toBe(35);
    expect(h.topAgencies.length).toBe(1);
    expect(h.topAgencies[0].count).toBeNull();
    expect(h.topAgencies[0].count_unavailable).toBe(true);
    expect(h.series[1].positiveObligations).toBe(13_350_000);
    expect(h.summary.activity_status).toBe('active');
    expect(h.summary.last_positive_obligation_fy).toBe(2026);
    expect(h.summary.activity_observation_period.series_coverage).toBe('adequate');
    expect(h.counting_bases.unique_awards).toBe(35);
    expect(h.coverage_timestamp.last_recipient_action_meaning).toMatch(/not the ingest/i);
    expect(h.coverage_timestamp.warehouse_max_action_date).toBe('2026-09-18');
    expect(h.coverage_timestamp.ingest.freshness_status).toBe('healthy');
    expect(h.coverage_timestamp.coverage_complete_established).toBe(true);
    expect(h.historical_set_asides.labels).toContain('8(A) SOLE SOURCE');
    expect(h.historical_set_asides.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2022);
    expect(h.historical_set_asides.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2019);
    expect(h.historical_set_asides.last_fy_by_label['8(A) SOLE SOURCE']).toBe(2022);
    expect(h.historical_set_asides.deprecated.last_fy_by_label.status).toBe('deprecated');
    expect(h.historical_set_asides.scope).toEqual({ kind: 'history_single_uei', uei_count: 1 });
    expect(h.historical_set_asides.contributing_ueis_by_label['8(A) SOLE SOURCE']).toContain('FCJCDUZV7RM3');
    expect(h.historical_set_asides.supporting_actions_by_label['8(A) SOLE SOURCE'][0].award_id).toBe('A1');
    expect(h.historical_set_asides.coverage).toBe('complete');
    expect(h.historical_set_asides.note).toMatch(/does not establish graduation|not.*certification/i);
    expect(h.historical_set_asides.note).toMatch(/last_observed_action_fy|deobligation|not award origin/i);
    expect(h.historical_set_asides).not.toHaveProperty('award_origin_fy_by_label');
    expect(h.recentAwards[0].isModification).toBe(false);
    expect(h.recentAwards[0].modClassification).toBe('base');
    expect(h.recentAwards[0].dateRangeValid).toBeNull();
    expect(h.recentAwards[0].dateRangeAssessment).toBe('unassessable');
    expect(h.recentAwards[0].grain).toBe('obligation_action');
  });

  it('flags invalid date ranges and modification actions on recent rows', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:recent-awards:25:v4-m`, [{
      award_id: 'A1', piid: 'P1', mod_number: 'P00007', awarding_agency: 'DOT', awarding_office: null,
      naics_code: '541511', naics_description: null, description: 'Work',
      obligation_amount: 1000, action_date: '2019-04-17',
      pop_start_date: '2018-07-20', pop_end_date: '2018-06-19', pop_state: 'MD', set_aside: '8(A) SOLE SOURCE',
    }]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.recentAwards[0].isModification).toBe(true);
    expect(h.recentAwards[0].modClassification).toBe('modification');
    expect(h.recentAwards[0].dateRangeIssue).toBe('end_before_start');
    expect(h.recentAwards[0].dateRangeValid).toBe(false);
    expect(h.recentAwards[0].dateRangeAssessment).toBe('invalid');
    expect(h.recentAwards[0].startDate).toBe('2018-07-20');
    expect(h.recentAwards[0].endDate).toBe('2018-06-19');
  });

  it('keeps null/blank mod numbers unknown — not confirmed base', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:recent-awards:25:v4-m`, [{
      ...RECENT[0],
      mod_number: null,
    }]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.recentAwards[0].isModification).toBeNull();
    expect(h.recentAwards[0].modClassification).toBe('unknown');
  });

  it('does not claim current activity from an old sole positive FY', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:yearly-totals:v3-m`, [
      { fiscal_year: 2020, total_obligated: -100_000, positive_obligations: 50_000, deobligations: -150_000, award_count: 4 },
    ]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.summary.last_positive_obligation_fy).toBe(2020);
    expect(h.summary.activity_status).toBe('unknown');
    expect(h.summary.activity_observation_period.series_coverage).toBe('missing');
  });

  it('never invents positive/deobligation components from net-only yearly rows', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:yearly-totals:v3-m`, [
      { fiscal_year: 2025, total_obligated: 1_000_000, award_count: 2 },
      { fiscal_year: 2026, total_obligated: 500_000, award_count: 1 },
    ]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.series[0].positiveObligations).toBeUndefined();
    expect(h.summary.activity_status).toBe('unknown');
    expect(h.summary.activity_note).toMatch(/not used|not fully established|Components are never inferred/i);
  });

  it('splits positive obligations from deobligations inside an adequately covered window', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:yearly-totals:v3-m`, [
      { fiscal_year: 2019, total_obligated: 800_000, positive_obligations: 800_000, deobligations: 0, award_count: 3 },
      { fiscal_year: 2020, total_obligated: -100_000, positive_obligations: 50_000, deobligations: -150_000, award_count: 4 },
      { fiscal_year: 2025, total_obligated: 0, positive_obligations: 0, deobligations: 0, award_count: 1 },
      { fiscal_year: 2026, total_obligated: 0, positive_obligations: 0, deobligations: 0, award_count: 1 },
    ]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.summary.last_positive_obligation_fy).toBe(2020);
    expect(h.summary.activity_status).toBe('dormant');
    expect(h.series.find((y: { fiscalYear: number }) => y.fiscalYear === 2020)?.positiveObligations).toBe(50_000);
    expect(h.counting_bases.fiscal_year_award_count_sum).toBe(9);
    expect(h.counting_bases.unique_awards).toBe(35);
  });

  it('marks enrichment budget_limited when only the set-aside history query is unavailable', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    unavailableKeys.add(`rollup:${k}:set-aside-history:v4-m`);
    detailByKey.delete(`rollup:${k}:set-aside-history:v4-m`);

    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.enrichment_status).toBe('budget_limited');
    expect(h.partial).toBe(true);
    expect(h.historical_set_asides.labels).toEqual([]);
    expect(h.historical_set_asides.coverage).toBe('unavailable');
    expect(h.historical_set_asides.note).toMatch(/not retrieved/i);
    // Other detail still present — incompleteness is specifically the set-aside gap.
    expect(h.topAgencies.length).toBe(1);
    expect(h.series.length).toBe(2);
  });

  it('warm profile + missing detail caches (award_count>0) → budget_limited, not complete zeros', async () => {
    profileRows = [PROFILE];
    // No detail rows seeded — cacheOnly miss path marks unavailable in real cache;
    // here we mark the detail keys unavailable explicitly.
    const k = 'single:FCJCDUZV7RM3';
    unavailableKeys.add(`rollup:${k}:yearly-totals:v3-m`);
    unavailableKeys.add(`rollup:${k}:top-agencies:8:v4-m`);
    unavailableKeys.add(`rollup:${k}:top-naics:8:v2-m`);
    unavailableKeys.add(`rollup:${k}:recent-awards:25:v4-m`);
    unavailableKeys.add(`rollup:${k}:yearly-by-agency:v2-m`);
    unavailableKeys.add(`rollup:${k}:set-aside-history:v4-m`);

    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.source).toBe('bigquery_normalized');
    expect(h.enrichment_status).toBe('budget_limited');
    expect(h.partial).toBe(true);
    expect(h.coverage).toBe('limited');
    expect(h.summary.awardCount).toBe(35);
    expect(h.topAgencies).toEqual([]);
    expect(h.historical_set_asides.coverage).toBe('unavailable');
    expect(h.message).toMatch(/not fetched|not retrieved/i);
  });

  it('never labels a zero-dollar agency-year as unused vehicle', async () => {
    profileRows = [PROFILE];
    seedCompleteDetails('FCJCDUZV7RM3');
    const k = 'single:FCJCDUZV7RM3';
    detailByKey.set(`rollup:${k}:yearly-by-agency:v2-m`, [
      { fiscal_year: 2025, awarding_agency: 'General Services Administration', total_amount: 0, award_count: 2 },
    ]);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    const cell = h.series.find((y: { fiscalYear: number }) => y.fiscalYear === 2025)?.agencyBreakdown?.[0];
    expect(cell).toMatchObject({
      agency: 'General Services Administration',
      amount: 0,
      count: 2,
      classification: 'zero_net_obligations',
      unused_vehicle: false,
    });
    expect(cell.classification_note).toMatch(/not classified as an unused vehicle/i);
  });

  it('genuine zero-award profile: empty details remain complete', async () => {
    profileRows = [{ ...PROFILE, award_count: 0, total_obligated: 0 }];
    const k = 'single:FCJCDUZV7RM3';
    unavailableKeys.add(`rollup:${k}:top-agencies:8:v4-m`);
    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.enrichment_status).toBe('complete');
    expect(h.partial).toBe(false);
    expect(h.summary.awardCount).toBe(0);
  });
});
