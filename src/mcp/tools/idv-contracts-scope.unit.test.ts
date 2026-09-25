/**
 * search_idv_contracts routing: a vehicle/parent scope goes to the shared scoped search; everything
 * else keeps the original USASpending path with the SAME arguments as before (acceptance 7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchIDVContracts = vi.fn();
const searchScopedTaskOrders = vi.fn();
vi.mock('@/lib/idv-search', () => ({ searchIDVContracts: (...a: unknown[]) => searchIDVContracts(...a) }));
vi.mock('@/lib/vehicles/task-order-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vehicles/task-order-search')>()),
  searchScopedTaskOrders: (...a: unknown[]) => searchScopedTaskOrders(...a),
}));

import { idvContracts } from './idv-contracts';

beforeEach(() => { searchIDVContracts.mockReset(); searchScopedTaskOrders.mockReset(); });

describe('unscoped task-order search is unchanged', () => {
  it('calls USASpending with exactly the legacy options and returns the legacy shape', async () => {
    searchIDVContracts.mockResolvedValue({ contracts: [{ awardId: 'A1', recipientName: 'X', description: 'd', agency: 'GSA' }], totalCount: 1, page: 1, hasNextPage: false, searchType: 'task_orders' });
    const r = await idvContracts({ naics: '541611', search_type: 'task', limit: 5 });
    expect(searchScopedTaskOrders).not.toHaveBeenCalled();
    expect(searchIDVContracts).toHaveBeenCalledWith({
      naicsCode: '541611', pscCode: undefined, agency: undefined, state: undefined, stateFilterType: undefined,
      minValue: undefined, dateFrom: undefined, dateTo: undefined, searchType: 'task', limit: 5, page: undefined,
    });
    expect(Object.keys(r).sort()).toEqual(['_meta', 'contracts', 'has_next_page', 'queried', 'search_type']);
  });
});

describe('scoped search', () => {
  const base = {
    status: 'ok', reason: null, scope: { status: 'resolved', kind: 'vehicle', label: 'OASIS+' }, population: 'p',
    total: 2, mapped_total: 1, unmapped_total: 1, parent_orders_in_population: 9, unattributed_orders: 4,
    page: 1, limit: 25, has_next_page: false, map_url: 'https://getmindy.ai/opportunity-map?mode=recompete',
    orders: [{
      contract_id: 'CONT_AWD_A_9700_47QRCA25DA002_4732', piid: 'A', recipient_name: 'R', recipient_uei: 'U', agency: 'DOD', sub_agency: 'ARMY',
      description: 'MANAGEMENT CONSULTING', naics_code: '541611', naics_description: 'x', psc_description: 'y', potential_total_value: 10,
      total_obligation: 5, period_end: '2027-01-01', place_of_performance_state: 'VA', on_map: true,
      parent: { parent_id: 'CONT_IDV_47QRCA25DA002_4732', source: 'contract_id', vehicle: { key: 'oasis_plus', label: 'OASIS+', solicitation_identifier: '47QRCA23R0002', pool: '8(a)' } },
      work_evidence: [{ term: 'management', fields: ['description'] }], usaspending_url: 'u',
    }],
  };
  it('vehicle routes to the scoped search and carries status, evidence, coverage and the map link', async () => {
    searchScopedTaskOrders.mockResolvedValue(base);
    const r = await idvContracts({ vehicle: 'OASIS+', work: 'management consulting', search_type: 'task' });
    expect(searchIDVContracts).not.toHaveBeenCalled();
    expect(searchScopedTaskOrders).toHaveBeenCalledWith(expect.objectContaining({ vehicle: 'OASIS+', work: 'management consulting' }));
    expect(r.status).toBe('ok');
    expect(r._meta).toEqual({ grounded: true, degraded: false, count: 1, total: 2 });
    expect(r.coverage).toMatchObject({ parent_orders_in_population: 9, unattributed_orders: 4 });
    expect(r.map).toMatchObject({ url: base.map_url, mapped_total: 1, unmapped_total: 1 });
    const c = r.contracts[0] as { parent: { parent_id: string } };
    expect(c.parent.parent_id).toBe('CONT_IDV_47QRCA25DA002_4732');
  });
  it('applied scoped filters reach the executed search unchanged (state only with state_scope pop)', async () => {
    searchScopedTaskOrders.mockResolvedValue({ ...base, applied_filters: [] });
    await idvContracts({ vehicle: 'OASIS+', work: 'w', naics: '541611', agency: 'DHS', state: 'VA', state_scope: 'pop', min_value: 1_000_000, lead_months: 24, limit: 7, page: 2 });
    expect(searchScopedTaskOrders).toHaveBeenCalledWith({
      vehicle: 'OASIS+', parent_id: undefined, work: 'w', naics: '541611', agency: 'DHS', state: 'VA',
      min_value: 1_000_000, lead_months: 24, limit: 7, page: 2,
    });
  });
  it('unresolved is reported as unresolved with total null — never zero orders', async () => {
    searchScopedTaskOrders.mockResolvedValue({ ...base, status: 'unresolved', reason: 'ambiguous', total: null, mapped_total: null, unmapped_total: null, orders: [], map_url: null });
    const r = await idvContracts({ vehicle: 'OASIS' });
    expect(r.status).toBe('unresolved');
    expect(r._meta.total).toBeNull();
    expect(r.map?.url).toBeNull();
  });
  it('an erroring scoped search is degraded, never an empty success', async () => {
    searchScopedTaskOrders.mockRejectedValue(new Error('boom'));
    const r = await idvContracts({ parent_id: 'CONT_IDV_47QRCA25DA002_4732' });
    expect(r.status).toBe('degraded');
    expect(r._meta).toMatchObject({ degraded: true, total: null });
  });
  it('work without a vehicle/parent is refused with a reason, not silently dropped', async () => {
    const r = await idvContracts({ work: 'management consulting' });
    expect(r.status).toBe('needs_refinement');
    expect(searchIDVContracts).not.toHaveBeenCalled();
    expect(searchScopedTaskOrders).not.toHaveBeenCalled();
  });
});
