/**
 * get_expiring_contracts: each returned award carries how it was competed, from its own record. The row columns
 * competition_type / number_of_offers are 0% filled by the sync (15/15 VA HVAC rows empty, 2026-11-27).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/recompete/query', () => ({ queryExpiringContracts: queryMock }));

import { expiringContracts, COMPETITION_LOOKUP_CAP } from './expiring-contracts';
import type { AwardCompetitionFields } from '@/lib/opportunities/competition-facts';

const WINDOW = { after: '2026-11-27', through: '2028-05-27', as_of: '2026-11-27', months: 18 };
const row = (id: string) => ({
  contract_id: id, piid: id, incumbent_name: 'X', awarding_agency: 'VA', awarding_sub_agency: null, naics_code: '238220',
  period_of_performance_current_end: '2027-06-01', place_of_performance_state: 'DC', place_of_performance_city: 'Washington',
  total_obligation: 5, description: 'hvac', award_kind: 'standalone_contract', parent_vehicle_piid: null, parent_vehicle_id: null,
  competition_type: null, number_of_offers: null,
});
const RECORDS: Record<string, AwardCompetitionFields | null> = {
  A: { extent_competed: 'A', extent_competed_description: 'FULL AND OPEN COMPETITION', number_of_offers_received: '4' },
  B: { extent_competed: 'B', extent_competed_description: 'NOT AVAILABLE FOR COMPETITION', other_than_full_and_open_description: 'ONLY ONE SOURCE' },
  C: { extent_competed: 'A', number_of_offers_received: null },
  D: null, // USASpending miss
};
const lookup = vi.fn(async (id: string) => RECORDS[id] ?? null);
const opts = { vehicleLookup: async () => null, competition: { lookup } };

beforeEach(() => {
  lookup.mockClear();
  queryMock.mockReset();
});

describe('competition on expiring contracts', () => {
  it('attaches each award\'s competition; offers null = not reported; a miss is unknown', async () => {
    queryMock.mockResolvedValue({ contracts: ['A', 'B', 'C', 'D'].map(row), total: 4, count: 4, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220', state: 'DC' }, opts);
    const by = Object.fromEntries(r.contracts.map((c) => [c.contract_id, c.competition]));
    expect(by.A).toMatchObject({ class: 'competed', offers_received: 4 });
    expect(by.B).toMatchObject({ class: 'not_competed', sole_source_reason: 'ONLY ONE SOURCE' });
    expect(by.C).toMatchObject({ class: 'competed', offers_received: null });
    expect(by.D).toMatchObject({ class: 'unknown', offers_received: null });
    expect(r._meta.competition).toEqual({ source: 'usaspending_award', checked: 4, not_checked: 0, competed: 2, not_competed: 1, unknown: 1, offers_reported: 1 });
  });
  it('rows past the cap are NOT looked up: competition null + counted not_checked (never unknown/zero)', async () => {
    const ids = Array.from({ length: COMPETITION_LOOKUP_CAP + 3 }, (_, i) => `R${i}`);
    queryMock.mockResolvedValue({ contracts: ids.map(row), total: ids.length, count: ids.length, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, opts);
    expect(lookup).toHaveBeenCalledTimes(COMPETITION_LOOKUP_CAP);
    expect(r.contracts.at(-1)!.competition).toBeNull();
    expect(r._meta.competition).toMatchObject({ checked: COMPETITION_LOOKUP_CAP, not_checked: 3 });
  });
  it('off by default: no lookups, no competition fields (report/match callers unchanged)', async () => {
    queryMock.mockResolvedValue({ contracts: [row('A')], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => null });
    expect(lookup).not.toHaveBeenCalled();
    expect('competition' in r.contracts[0]).toBe(false);
    expect(r._meta.competition).toBeUndefined();
  });
});
