import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getTaskOrders() — the join-key trap fix + graceful-degrade contract.
 *
 * The core claim under test: the ONLY safe BigQuery query is
 * `recipient_uei = @uei AND (piid = @piid OR parent_piid = @piid)`. A bare
 * piid-only match (no recipient_uei co-filter) is what produced the measured
 * 64,016-txn/$28.7B over-match on PIID "0002" — these tests lock the query
 * shape and every input that must refuse rather than risk that trap.
 */

const bqQueryMock = vi.fn();
const withCacheMock = vi.fn();
const geocodeCityMock = vi.fn();

vi.mock('@/lib/bigquery/client', () => ({
  bqQuery: (...args: unknown[]) => bqQueryMock(...args),
}));
vi.mock('@/lib/mcp/external-cache', () => ({
  withCache: (...args: unknown[]) => withCacheMock(...args),
}));
vi.mock('@/lib/geo/city-geocode', () => ({
  geocodeCity: (...args: unknown[]) => geocodeCityMock(...args),
  stableSeed: (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  },
}));

import { getTaskOrders, compactMoney } from './task-orders';

beforeEach(() => {
  bqQueryMock.mockReset();
  withCacheMock.mockReset();
  geocodeCityMock.mockReset();
  // Default: withCache just calls the fetcher through (fromCache:false) so most
  // tests exercise the real fetchTaskOrderRows() query-building path.
  withCacheMock.mockImplementation(async (_type: string, _params: unknown, _ttl: number, fetcher: () => Promise<unknown>) => ({
    value: await fetcher(),
    fromCache: false,
  }));
});

describe('getTaskOrders — graceful degrade (never risk the trap)', () => {
  it('refuses a row with no incumbent_uei (grouped/synthetic rows) rather than guess', async () => {
    const res = await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: null });
    expect(res.grounded).toBe(false);
    expect(res.reason).toBe('no_incumbent_uei');
    expect(bqQueryMock).not.toHaveBeenCalled();
  });

  it('refuses a collapsed multi-award-vehicle PIID ("(+N more)" suffix)', async () => {
    const res = await getTaskOrders({ piid: 'VA11816D1016 (+22 more)', incumbentUei: 'ABC123' });
    expect(res.grounded).toBe(false);
    expect(res.reason).toBe('collapsed_vehicle_piid');
    expect(bqQueryMock).not.toHaveBeenCalled();
  });

  it('refuses an empty/missing PIID', async () => {
    const res = await getTaskOrders({ piid: '', incumbentUei: 'ABC123' });
    expect(res.grounded).toBe(false);
    expect(res.reason).toBe('no_piid');
  });

  it('degrades to query_error (never throws) when BigQuery fails', async () => {
    withCacheMock.mockImplementation(async (_t: string, _p: unknown, _ttl: number, fetcher: () => Promise<unknown>) => {
      // exercise the real fetcher so the BQ mock rejection propagates
      return { value: await fetcher(), fromCache: false };
    });
    bqQueryMock.mockRejectedValueOnce(new Error('quota exceeded'));
    const res = await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(res.grounded).toBe(false);
    expect(res.reason).toBe('query_error');
    expect(res.txns).toEqual([]);
  });

  it('reports no_task_orders (not an error) when the scoped query legitimately returns zero rows', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    const res = await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(res.grounded).toBe(false);
    expect(res.reason).toBe('no_task_orders');
  });
});

describe('getTaskOrders — the proven-safe join key', () => {
  it('scopes the BigQuery WHERE by BOTH piid-lineage AND recipient_uei (the fix)', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(bqQueryMock).toHaveBeenCalledTimes(1);
    const call = bqQueryMock.mock.calls[0][0];
    // The query text must scope by recipient_uei, not just piid/parent_piid —
    // this is the exact clause that collapsed the 64,016-txn over-match to 66.
    expect(call.query).toMatch(/recipient_uei\s*=\s*@uei/);
    expect(call.query).toMatch(/piid\s*=\s*@piid/);
    expect(call.query).toMatch(/parent_piid\s*=\s*@piid/);
    expect(call.params).toEqual({ piid: 'N0003921F3007', uei: 'VV9KH3L99VE3' });
  });

  it('caches on the (piid, uei) pair so a repeat drawer-open is free', async () => {
    bqQueryMock.mockResolvedValueOnce([]);
    await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(withCacheMock).toHaveBeenCalledTimes(1);
    const [apiType, params] = withCacheMock.mock.calls[0];
    expect(apiType).toBe('recompete:task-orders');
    expect(params).toEqual({ piid: 'N0003921F3007', uei: 'VV9KH3L99VE3' });
  });
});

describe('getTaskOrders — the real drawer-stream shape', () => {
  it('computes totalActual, distinctCities, and per-txn geocode from real-shaped rows', async () => {
    geocodeCityMock
      .mockReturnValueOnce({ lat: 38.87, lng: -76.98, precision: 'city' }) // Washington Navy Yard DC
      .mockReturnValueOnce({ lat: 38.87, lng: -76.98, precision: 'city' })
      .mockReturnValueOnce({ lat: 32.7, lng: -117.1, precision: 'city' }); // San Diego CA
    bqQueryMock.mockResolvedValueOnce([
      { obligation_amount: 37_200_000, action_date: '2025-04-30', pop_city: 'Washington Navy Yard', pop_state: 'DC', recipient_uei: 'VV9KH3L99VE3' },
      { obligation_amount: 27_100_000, action_date: '2023-04-19', pop_city: 'Washington Navy Yard', pop_state: 'DC', recipient_uei: 'VV9KH3L99VE3' },
      { obligation_amount: 24_000_000, action_date: '2022-01-05', pop_city: 'San Diego', pop_state: 'CA', recipient_uei: 'VV9KH3L99VE3' },
    ]);
    const res = await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(res.grounded).toBe(true);
    expect(res.txns).toHaveLength(3);
    expect(res.totalActual).toBe(37_200_000 + 27_100_000 + 24_000_000);
    expect(res.distinctCities).toBe(2); // DC + San Diego
    expect(res.txns[0].lat).toBe(38.87);
    expect(res.txns[0].locPrecision).toBe('city');
  });

  it('never fabricates a coordinate — a row with no city AND no recognizable state gets null lat/lng', async () => {
    geocodeCityMock.mockReturnValueOnce(null); // unrecognized state
    bqQueryMock.mockResolvedValueOnce([
      { obligation_amount: 5000, action_date: '2024-01-01', pop_city: null, pop_state: 'ZZ', recipient_uei: 'VV9KH3L99VE3' },
    ]);
    const res = await getTaskOrders({ piid: 'N0003921F3007', incumbentUei: 'VV9KH3L99VE3' });
    expect(res.txns[0].lat).toBeNull();
    expect(res.txns[0].lng).toBeNull();
    expect(res.txns[0].locPrecision).toBeNull();
  });
});

describe('compactMoney — matches the map pin formatter', () => {
  it('formats billions/millions/thousands like the pin tag', () => {
    expect(compactMoney(37_200_000)).toBe('$37.2M');
    expect(compactMoney(1_500_000_000)).toBe('$1.5B');
    expect(compactMoney(8_500)).toBe('$9K');
    expect(compactMoney(0)).toBe('');
    expect(compactMoney(-5)).toBe('');
  });
});
