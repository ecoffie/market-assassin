/**
 * Ask Mindy Phase 1 (P1-2): get_expiring_contracts must never silently drop a filter, and an
 * in-window task order must never be visible only inside vehicles[].
 *
 * Baseline failures this guards (R1/R2, 2026-11-13): a NAICS array was dropped by a
 * `typeof === 'string'` guard (query went national), a comma list exact-matched to 0, "Tennessee"
 * returned 0, and the correct 561320/TN call returned contracts:[] with count 0 while the
 * qualifying orders (36C24927N0097, 15JA4522F00000022) sat nested under vehicles[].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/recompete/query', () => ({ queryExpiringContracts: queryMock }));

import { expiringContracts, resolveNaicsArg, resolveStateArg } from './expiring-contracts';
import { annotateResultContract } from '@/lib/mcp/result-contract';
import { runMcpTool, toolParameters } from '@/lib/mcp/tool-registry';

const WINDOW = { after: '2026-11-14', through: '2028-05-14', as_of: '2026-11-14', months: 18 };
const order = (id: string, piid: string, parent: string, end: string, state = 'TN') => ({
  contract_id: id, piid, incumbent_name: 'AllPro', awarding_agency: 'Department of Veterans Affairs',
  awarding_sub_agency: null, naics_code: '561320', period_of_performance_current_end: end,
  place_of_performance_state: state, place_of_performance_city: 'Memphis', total_obligation: 100000,
  description: 'temporary staffing', award_kind: 'order_under_vehicle',
  parent_vehicle_piid: parent, parent_vehicle_id: `CONT_IDV_${parent}_1`,
});
const standalone = (id: string) => ({
  contract_id: id, piid: id, incumbent_name: 'X', awarding_agency: 'DOE', awarding_sub_agency: null,
  naics_code: '561110', period_of_performance_current_end: '2027-06-01', place_of_performance_state: 'TN',
  place_of_performance_city: 'Oak Ridge', total_obligation: 5, description: 'clerical', award_kind: 'standalone_contract',
  parent_vehicle_piid: null, parent_vehicle_id: null,
});
const noLookup = { vehicleLookup: async () => null };

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ contracts: [], total: 0, count: 0, duplicates_collapsed: 0, degraded: false, window: WINDOW });
});

describe('argument normalization (never silently dropped)', () => {
  it('NAICS: string, comma list, array, and junk is reported', () => {
    expect(resolveNaicsArg('561320')).toEqual({ codes: ['561320'], invalid: [] });
    expect(resolveNaicsArg('5613, 5611,4931')).toEqual({ codes: ['5613', '5611', '4931'], invalid: [] });
    expect(resolveNaicsArg(['5613', '5611'])).toEqual({ codes: ['5613', '5611'], invalid: [] });
    expect(resolveNaicsArg('staffing')).toEqual({ codes: [], invalid: ['staffing'] });
  });
  it('States: names, codes, "or" lists, arrays; the Oregon code OR survives', () => {
    expect(resolveStateArg('Tennessee').codes).toEqual(['TN']);
    expect(resolveStateArg('Tennessee, Mississippi or Arkansas').codes).toEqual(['TN', 'MS', 'AR']);
    expect(resolveStateArg(['TN', 'ms', 'Arkansas']).codes).toEqual(['TN', 'MS', 'AR']);
    expect(resolveStateArg('OR').codes).toEqual(['OR']);
    expect(resolveStateArg('New York and New Jersey').codes).toEqual(['NY', 'NJ']);
    expect(resolveStateArg('Narnia')).toEqual({ codes: [], invalid: ['Narnia'] });
  });
});

describe('query receives every filter', () => {
  it('passes a comma NAICS list and a multi-state name list to the query as arrays', async () => {
    await expiringContracts({ naics: '5613,5611,4931', state: 'TN, MS or Arkansas' }, noLookup);
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ naicsCodes: ['5613', '5611', '4931'], states: ['TN', 'MS', 'AR'] }));
  });
  it('an unrecognizable state is NOT dropped: no query runs, result is filter_not_applied', async () => {
    const r = await expiringContracts({ naics: '561320', state: 'Narnia' }, noLookup);
    expect(queryMock).not.toHaveBeenCalled();
    expect(r._meta).toMatchObject({ grounded: false, result_state: 'filter_not_applied', records_in_window: 0 });
    expect(r._meta.ignored_args).toEqual([expect.objectContaining({ arg: 'state', value: 'Narnia', reason: 'invalid_value' })]);
  });
  it('an all-junk NAICS is not dropped either (would have answered an all-industry question)', async () => {
    const r = await expiringContracts({ naics: 'staffing', state: 'TN' }, noLookup);
    expect(queryMock).not.toHaveBeenCalled();
    expect(r._meta.result_state).toBe('filter_not_applied');
  });
  it('a partly valid list runs with the valid values and reports the rest', async () => {
    queryMock.mockResolvedValue({ contracts: [standalone('S1')], total: 1, count: 1, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '561320', state: 'TN, Narnia' }, noLookup);
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ states: ['TN'] }));
    annotateResultContract(r, { naics: '561320', state: 'TN, Narnia' }, toolParameters('get_expiring_contracts'));
    expect(r._meta).toMatchObject({ applied_filters: { state: ['TN'] }, result_state: 'partial' });
  });
});

describe('in-window orders are listed at top level', () => {
  it('R1/R2 shape: contracts:[] but orders exist -> expiring_orders_in_window and records_in_window carry them', async () => {
    queryMock.mockResolvedValue({
      contracts: [
        order('O1', '36C24927N0097', '36C24918D0001', '2027-03-31'),
        order('O2', '15JA4522F00000022', '15JA4519D0002', '2027-09-07'),
      ],
      total: 2, count: 2, duplicates_collapsed: 0, degraded: false, window: WINDOW,
    });
    const r = await expiringContracts({ naics: '561320', state: 'Tennessee' }, noLookup);
    expect(r.contracts).toEqual([]);
    expect(r._meta.count).toBe(0); // existing field unchanged (standalone only)
    expect(r.vehicles.flatMap((v) => v.orders.map((o) => o.piid))).toEqual(['36C24927N0097', '15JA4522F00000022']); // unchanged
    expect(r.expiring_orders_in_window.map((o) => o.piid)).toEqual(['36C24927N0097', '15JA4522F00000022']);
    expect(r.expiring_orders_in_window[0]).toMatchObject({ place_of_performance_state: 'TN', parent_vehicle_piid: '36C24918D0001' });
    expect(r._meta).toMatchObject({ grounded: true, expiring_orders_in_window: 2, records_in_window: 2, window: WINDOW });
    annotateResultContract(r, { naics: '561320', state: 'Tennessee' }, toolParameters('get_expiring_contracts'));
    expect(r._meta.result_state).toBe('results');
  });
  it('flags a row-limited result as incomplete (partial), never as the full list', async () => {
    queryMock.mockResolvedValue({ contracts: [standalone('S1')], total: 37, count: 37, duplicates_collapsed: 0, degraded: false, window: WINDOW });
    const r = await expiringContracts({ naics: '5611', limit: 1 }, noLookup);
    expect(r._meta.incomplete_reason).toMatch(/returned 1 of 37/);
    annotateResultContract(r, { naics: '5611', limit: 1 }, toolParameters('get_expiring_contracts'));
    expect(r._meta.result_state).toBe('partial');
  });
  it('an errored query stays unavailable, not a zero', async () => {
    queryMock.mockResolvedValue({ contracts: [], total: 0, count: null, duplicates_collapsed: 0, degraded: true, window: WINDOW });
    const r = await expiringContracts({ naics: '561320' }, noLookup);
    annotateResultContract(r, { naics: '561320' }, toolParameters('get_expiring_contracts'));
    expect(r._meta.result_state).toBe('unavailable');
  });
});

describe('through the registry (what chat and MCP actually call)', () => {
  it('a NAICS array from the model reaches the query and is not reported as ignored', async () => {
    const { result } = await runMcpTool('get_expiring_contracts', { naics: ['5613', '5611', '4931'], state: ['TN', 'MS', 'AR'] }, { userEmail: 't@example.com' } as never);
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ naicsCodes: ['5613', '5611', '4931'], states: ['TN', 'MS', 'AR'] }));
    expect((result._meta as { ignored_args: unknown[] }).ignored_args).toEqual([]);
    expect((result._meta as { result_state: string }).result_state).toBe('none_found');
  });
});
