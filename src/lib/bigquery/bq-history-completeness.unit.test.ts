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
const YEARLY = [{ fiscal_year: 2025, total_obligated: 23_350_000, award_count: 35 }];
const RECENT = [{
  award_id: 'A1', piid: 'P1', awarding_agency: 'DOD', awarding_office: null,
  naics_code: '541512', naics_description: null, description: 'Work',
  obligation_amount: 1000, action_date: '2025-01-01',
  pop_start_date: null, pop_end_date: null, pop_state: 'AK', set_aside: null,
}];

function seedCompleteDetails(uei: string) {
  const k = `single:${uei}`;
  detailByKey.set(`rollup:${k}:yearly-totals:v2-m`, YEARLY);
  detailByKey.set(`rollup:${k}:top-agencies:8:v4-m`, AGENCY);
  detailByKey.set(`rollup:${k}:top-naics:8:v2-m`, NAICS);
  detailByKey.set(`rollup:${k}:recent-awards:25:v3-m`, RECENT);
  detailByKey.set(`rollup:${k}:yearly-by-agency:v2-m`, []);
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
  });

  it('warm profile + missing detail caches (award_count>0) → budget_limited, not complete zeros', async () => {
    profileRows = [PROFILE];
    // No detail rows seeded — cacheOnly miss path marks unavailable in real cache;
    // here we mark the detail keys unavailable explicitly.
    const k = 'single:FCJCDUZV7RM3';
    unavailableKeys.add(`rollup:${k}:yearly-totals:v2-m`);
    unavailableKeys.add(`rollup:${k}:top-agencies:8:v4-m`);
    unavailableKeys.add(`rollup:${k}:top-naics:8:v2-m`);
    unavailableKeys.add(`rollup:${k}:recent-awards:25:v3-m`);
    unavailableKeys.add(`rollup:${k}:yearly-by-agency:v2-m`);

    const h = await getBqContractorHistory({ uei: 'FCJCDUZV7RM3', liveBq: false });
    expect(h.source).toBe('bigquery_normalized');
    expect(h.enrichment_status).toBe('budget_limited');
    expect(h.partial).toBe(true);
    expect(h.coverage).toBe('limited');
    expect(h.summary.awardCount).toBe(35);
    expect(h.topAgencies).toEqual([]);
    expect(h.message).toMatch(/not fetched|not retrieved/i);
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
