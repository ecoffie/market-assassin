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
    expect(r._meta.competition).toMatchObject({ source: 'usaspending_award', checked: 4, not_checked: 0, competed: 2, not_competed: 1, unknown: 1, offers_reported: 1, set_aside_reported: 0, from_parent_vehicle: 0 });
    expect(r._meta.competition!.coverage_line).toBe('Competition checked on 4 of 4 contracts; offers reported on 1, set-aside reported on 0.');
  });
  it('rows past the cap are NOT looked up: competition null + counted not_checked (never unknown/zero)', async () => {
    const ids = Array.from({ length: COMPETITION_LOOKUP_CAP + 3 }, (_, i) => `R${i}`);
    queryMock.mockResolvedValue({ contracts: ids.map(row), total: ids.length, count: ids.length, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, opts);
    expect(lookup).toHaveBeenCalledTimes(COMPETITION_LOOKUP_CAP);
    expect(r.contracts.at(-1)!.competition).toBeNull();
    expect(r.contracts.at(-1)!.competition_status).toBe('not_checked');
    expect(r._meta.competition!.coverage_line).toMatch(/3 not checked \(lookup cap\)/);
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

describe('the stored row\'s empty competition columns are filled from the award record (prod Q2: SP470326C0003)', () => {
  // SP470326C0003 on USAspending: extent F (competed under SAP), 12 offers, SB set-aside - total. Q2 said "Not established"
  // because set_aside_type / number_of_offers stayed null on the row next to the filled competition object.
  const SP = { extent_competed: 'F', extent_competed_description: 'COMPETED UNDER SAP', number_of_offers_received: '12', type_set_aside_description: 'SMALL BUSINESS SET ASIDE - TOTAL' };
  it('fills set_aside_type, number_of_offers and competition_type with provenance; stored values are never overwritten', async () => {
    const stored = { ...row('SP'), set_aside_type: null, number_of_offers: null, competition_type: null };
    const kept = { ...row('KEEP'), set_aside_type: '8(a)' };
    queryMock.mockResolvedValue({ contracts: [stored, kept], total: 2, count: 2, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => null, competition: { lookup: async () => SP } });
    const sp = r.contracts.find((c) => c.contract_id === 'SP')!;
    expect(sp).toMatchObject({ set_aside_type: 'SB-Total', number_of_offers: 12, competition_type: 'COMPETED UNDER SAP', competition_fields_source: 'usaspending_award', competition_status: 'checked' });
    expect(sp.competition).toMatchObject({ class: 'competed', label: 'Competed · SB set-aside', offers_received: 12 });
    expect(r.contracts.find((c) => c.contract_id === 'KEEP')!.set_aside_type).toBe('8(a)');
    expect(r._meta.competition).toMatchObject({ offers_reported: 2, set_aside_reported: 2 });
  });
  it('an unknown record leaves the columns null ("not reported"), never 0', async () => {
    queryMock.mockResolvedValue({ contracts: [row('U')], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => null, competition: { lookup: async () => null } });
    expect(r.contracts[0].number_of_offers).toBeNull();
    expect(r.contracts[0].set_aside_type ?? null).toBeNull();
    expect(r.contracts[0].competition_fields_source).toBeNull();
  });
  it('an order whose own record is silent reads its parent vehicle (source usaspending_parent_idv)', async () => {
    const order = { ...row('ORD'), award_kind: 'order_under_vehicle', parent_vehicle_piid: 'V1', parent_vehicle_id: 'CONT_IDV_V1' };
    queryMock.mockResolvedValue({ contracts: [order], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const lookup = async (id: string) => (id === 'CONT_IDV_V1' ? { extent_competed: 'A', number_of_offers_received: '7', type_set_aside_description: 'SMALL BUSINESS SET ASIDE - TOTAL' } : {});
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => ({ id: 'CONT_IDV_V1', ordering_end_date: null }) as never, competition: { lookup } });
    const o = [...r.contracts, ...r.expiring_orders_in_window].find((c) => c.contract_id === 'ORD')!;
    expect(o.competition).toMatchObject({ class: 'competed', source: 'usaspending_parent_idv', offers_received: 7 });
    expect(o.competition_fields_source).toBe('usaspending_parent_idv');
    expect(r._meta.competition!.from_parent_vehicle).toBe(1);
  });
  it('Q31: an order classed from its OWN record but missing its offer count gets the parent vehicle\'s count, labelled', async () => {
    const order = { ...row('ORD2'), award_kind: 'order_under_vehicle', parent_vehicle_piid: 'V2', parent_vehicle_id: 'CONT_IDV_V2' };
    queryMock.mockResolvedValue({ contracts: [order], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    // W91YTZ25FA135 shape on USAspending: extent A, no offers on the order; the vehicle reports 2.
    const lookup = async (id: string) => (id === 'CONT_IDV_V2' ? { extent_competed: 'A', number_of_offers_received: '2' } : { extent_competed: 'A', place_of_performance_city: 'FORT MOORE', place_of_performance_state: 'GA' });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => ({ id: 'CONT_IDV_V2', ordering_end_date: null }) as never, competition: { lookup } });
    const o = r.expiring_orders_in_window.find((c) => c.contract_id === 'ORD2')!;
    expect(o.competition).toMatchObject({ class: 'competed', source: 'usaspending_award', offers_received: 2, offers_source: 'usaspending_parent_idv' });
    expect(o).toMatchObject({ number_of_offers: 2, number_of_offers_source: 'usaspending_parent_idv' });
    expect(o.competition!.award_record).toMatchObject({ place_of_performance_city: 'FORT MOORE' }); // the order's own place, not the vehicle's
    expect(r._meta.competition).toMatchObject({ from_parent_vehicle: 0, offers_from_parent_vehicle: 1, offers_reported: 1 });
    expect(r._meta.competition!.coverage_line).toMatch(/offers reported on 1 \(1 from the parent vehicle\)/);
  });
  it('a parent-substituted competition keeps the ORDER\'s own place and period', async () => {
    const order = { ...row('ORD3'), place_of_performance_city: null, place_of_performance_state: null, award_kind: 'order_under_vehicle', parent_vehicle_piid: 'V3', parent_vehicle_id: 'CONT_IDV_V3' };
    queryMock.mockResolvedValue({ contracts: [order], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const lookup = async (id: string) => (id === 'CONT_IDV_V3'
      ? { extent_competed: 'A', number_of_offers_received: '5', place_of_performance_city: 'VEHICLE CITY', period_potential_end: '2035-01-01 00:00:00' }
      : { place_of_performance_city: 'ATHENS', place_of_performance_state: 'GA', period_current_end: '2027-02-28', period_potential_end: '2031-02-28 00:00:00' });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => ({ id: 'CONT_IDV_V3', ordering_end_date: null }) as never, competition: { lookup } });
    const o = r.expiring_orders_in_window.find((c) => c.contract_id === 'ORD3')!;
    expect(o.competition).toMatchObject({ source: 'usaspending_parent_idv', offers_received: 5 });
    expect(o).toMatchObject({ place_of_performance_city: 'ATHENS', place_of_performance_state: 'GA', place_of_performance_source: 'usaspending_award', period_of_performance_potential_end: '2031-02-28' });
  });
});

describe('place of performance and period ends from the award record (Q13/Q26 city, Q34 potential end)', () => {
  const REC = { extent_competed: 'A', place_of_performance_city: 'MARIETTA', place_of_performance_state: 'GA', period_current_end: '2027-02-28', period_potential_end: '2031-02-28 00:00:00' };
  it('fills an empty city/state from the award record, labelled; exposes current and potential end separately', async () => {
    const empty = { ...row('E'), place_of_performance_city: null, place_of_performance_state: null, period_of_performance_current_end: '2027-02-28' };
    queryMock.mockResolvedValue({ contracts: [empty], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => null, competition: { lookup: async () => REC } });
    expect(r.contracts[0]).toMatchObject({
      place_of_performance_city: 'MARIETTA', place_of_performance_state: 'GA', place_of_performance_source: 'usaspending_award',
      period_of_performance_current_end: '2027-02-28', period_of_performance_current_end_record: '2027-02-28', period_of_performance_potential_end: '2031-02-28',
    });
  });
  it('a stored city is kept (source stored); an unreported one stays null; a row past the cap gets no dates', async () => {
    const stored = row('S'); // Washington, DC
    const none = { ...row('N'), place_of_performance_city: null, place_of_performance_state: null };
    queryMock.mockResolvedValue({ contracts: [stored, none], total: 2, count: 2, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => null, competition: { lookup: async (id: string) => (id === 'S' ? REC : { extent_competed: 'A' }) } });
    const by = Object.fromEntries(r.contracts.map((c) => [c.contract_id, c]));
    expect(by.S).toMatchObject({ place_of_performance_city: 'Washington', place_of_performance_state: 'DC', place_of_performance_source: 'stored', period_of_performance_potential_end: '2031-02-28' });
    expect(by.N).toMatchObject({ place_of_performance_city: null, place_of_performance_state: null, place_of_performance_source: null, period_of_performance_potential_end: null });
  });
  it('a parent-substituted competition never carries the PARENT\'s order-level fair opportunity', async () => {
    const order = { ...row('ORD4'), award_kind: 'order_under_vehicle', parent_vehicle_piid: 'V4', parent_vehicle_id: 'CONT_IDV_V4' };
    queryMock.mockResolvedValue({ contracts: [order], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const lookup = async (id: string) => (id === 'CONT_IDV_V4' ? { extent_competed: 'A', number_of_offers_received: '4', fair_opportunity_limited_sources_description: 'URGENCY' } : {});
    const r = await expiringContracts({ naics: '238220' }, { vehicleLookup: async () => ({ id: 'CONT_IDV_V4', ordering_end_date: null }) as never, competition: { lookup } });
    const o = r.expiring_orders_in_window.find((c) => c.contract_id === 'ORD4')!;
    expect(o.competition).toMatchObject({ source: 'usaspending_parent_idv', order_fair_opportunity: null, order_competed_among_holders: null });
  });
});

