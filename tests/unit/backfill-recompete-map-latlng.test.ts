import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * backfill-recompete-map-latlng.ts — dominant-city selection + the state-approx
 * fallback contract. The core claims under test:
 *  1. pickDominantCity() ranks by TOTAL OBLIGATION per (city,state) group, not raw
 *     txn count, and only trusts city-precision txns (never a task-order's own
 *     state-centroid fallback).
 *  2. resolveRecompeteMapLoc() degrades to 'state_approx' (map_lat/map_lng
 *     untouched) whenever getTaskOrders() isn't grounded or has no city — it NEVER
 *     fabricates a coordinate.
 */

const getTaskOrdersMock = vi.fn();
const geocodeCityMock = vi.fn();

vi.mock('@/lib/recompete/task-orders', () => ({
  getTaskOrders: (...args: unknown[]) => getTaskOrdersMock(...args),
}));
vi.mock('@/lib/geo/city-geocode', () => ({
  geocodeCity: (...args: unknown[]) => geocodeCityMock(...args),
  stableSeed: (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  },
}));

// The script creates its Supabase client at module scope (matching every other
// scripts/backfill-*.ts) — stub harmless env vars BEFORE importing it so the
// module load doesn't throw under vitest (no .env.local in a fresh worktree/CI).
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { pickDominantCity, resolveRecompeteMapLoc, TaskOrderLookupError } = await import('../../scripts/backfill-recompete-map-latlng');
type TaskOrderTxn = import('@/lib/recompete/task-orders').TaskOrderTxn;

function txn(over: Partial<TaskOrderTxn>): TaskOrderTxn {
  return {
    obligation: 0, actionDate: null, popCity: null, popState: null,
    lat: null, lng: null, locPrecision: null, recipientUei: 'UEI',
    ...over,
  };
}

beforeEach(() => {
  getTaskOrdersMock.mockReset();
  geocodeCityMock.mockReset();
});

describe('pickDominantCity — ranks by total obligation, city-precision only', () => {
  it('picks the (city,state) group with the largest SUM of obligation, not the most txns', () => {
    const txns: TaskOrderTxn[] = [
      // San Diego: 3 small txns totalling $300
      txn({ popCity: 'San Diego', popState: 'CA', obligation: 100, locPrecision: 'city', actionDate: '2020-01-01' }),
      txn({ popCity: 'San Diego', popState: 'CA', obligation: 100, locPrecision: 'city', actionDate: '2020-02-01' }),
      txn({ popCity: 'San Diego', popState: 'CA', obligation: 100, locPrecision: 'city', actionDate: '2020-03-01' }),
      // Norfolk: 1 big txn worth $10,000
      txn({ popCity: 'Norfolk', popState: 'VA', obligation: 10000, locPrecision: 'city', actionDate: '2019-01-01' }),
    ];
    const dominant = pickDominantCity(txns);
    expect(dominant).not.toBeNull();
    expect(dominant!.city).toBe('Norfolk');
    expect(dominant!.state).toBe('VA');
    expect(dominant!.totalObligation).toBe(10000);
  });

  it('breaks a tie in total obligation by most-recent action date', () => {
    const txns: TaskOrderTxn[] = [
      txn({ popCity: 'Austin', popState: 'TX', obligation: 5000, locPrecision: 'city', actionDate: '2021-01-01' }),
      txn({ popCity: 'Reston', popState: 'VA', obligation: 5000, locPrecision: 'city', actionDate: '2023-06-01' }),
    ];
    const dominant = pickDominantCity(txns);
    expect(dominant!.city).toBe('Reston'); // more recent wins the tie
  });

  it('ignores state-precision (non-city) txns entirely — never re-uses a fallback as "the city"', () => {
    const txns: TaskOrderTxn[] = [
      txn({ popCity: null, popState: 'OH', obligation: 999999, locPrecision: 'state', actionDate: '2024-01-01' }),
      txn({ popCity: 'Columbus', popState: 'OH', obligation: 1, locPrecision: 'city', actionDate: '2020-01-01' }),
    ];
    const dominant = pickDominantCity(txns);
    expect(dominant!.city).toBe('Columbus'); // the only city-precision hit, despite tiny $
  });

  it('returns null when no txn has city precision (all state-level or empty)', () => {
    expect(pickDominantCity([])).toBeNull();
    expect(pickDominantCity([txn({ popState: 'TX', locPrecision: 'state' })])).toBeNull();
  });

  it('groups repeat visits to the SAME city across multiple txns into one total', () => {
    const txns: TaskOrderTxn[] = [
      txn({ popCity: 'Tampa', popState: 'FL', obligation: 200, locPrecision: 'city', actionDate: '2022-01-01' }),
      txn({ popCity: 'TAMPA', popState: 'fl', obligation: 300, locPrecision: 'city', actionDate: '2022-02-01' }), // case-insensitive
      txn({ popCity: 'Miami', popState: 'FL', obligation: 400, locPrecision: 'city', actionDate: '2022-03-01' }),
    ];
    const dominant = pickDominantCity(txns);
    // Tampa's combined $500 beats Miami's $400
    expect(dominant!.city.toUpperCase()).toBe('TAMPA');
    expect(dominant!.totalObligation).toBe(500);
  });
});

describe('resolveRecompeteMapLoc — never fabricates, degrades honestly', () => {
  const row = { contract_id: 'C1', piid: 'N0003921F3007', incumbent_uei: 'VV9KH3L99VE3', place_of_performance_state: 'VA' };

  it('degrades to state_approx when getTaskOrders is not grounded', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({ grounded: false, reason: 'no_task_orders', txns: [], totalActual: 0, distinctCities: 0, fromCache: false });
    const res = await resolveRecompeteMapLoc(row);
    expect(res.outcome).toBe('state_approx');
    expect(res.lat).toBeUndefined();
    expect(geocodeCityMock).not.toHaveBeenCalled();
  });

  it('degrades to state_approx when grounded but no txn has a real city', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: true, txns: [txn({ popState: 'VA', locPrecision: 'state' })],
      totalActual: 100, distinctCities: 1, fromCache: false,
    });
    const res = await resolveRecompeteMapLoc(row);
    expect(res.outcome).toBe('state_approx');
  });

  it('returns task_order_city with a real coordinate when a dominant city resolves', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: true,
      txns: [txn({ popCity: 'Norfolk', popState: 'VA', obligation: 50000, locPrecision: 'city', actionDate: '2024-01-01' })],
      totalActual: 50000, distinctCities: 1, fromCache: false,
    });
    geocodeCityMock.mockReturnValueOnce({ lat: 36.85, lng: -76.29, precision: 'city' });
    const res = await resolveRecompeteMapLoc(row);
    expect(res.outcome).toBe('task_order_city');
    expect(res.lat).toBe(36.85);
    expect(res.lng).toBe(-76.29);
    expect(res.city).toBe('Norfolk');
  });

  it('falls back to state_approx if the dominant city somehow fails to re-geocode to city precision', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: true,
      txns: [txn({ popCity: 'Somewhere', popState: 'ZZ' as string, obligation: 1, locPrecision: 'city', actionDate: '2024-01-01' })],
      totalActual: 1, distinctCities: 1, fromCache: false,
    });
    geocodeCityMock.mockReturnValueOnce(null); // unrecognized state on re-geocode
    const res = await resolveRecompeteMapLoc(row);
    expect(res.outcome).toBe('state_approx');
  });
});

/**
 * FAIL-LOUD contract (the silent-degradation fix). A transient BigQuery error
 * (`reason:'query_error'` — quota exhausted / rate-limit / timeout / 5xx) must be
 * DISTINGUISHABLE from a genuine empty result:
 *   - BQ ERROR    → THROW TaskOrderLookupError → the worker leaves the row NULL + counts
 *                   it failed. NEVER stamped state_approx (that was the ~70K-row corruption).
 *   - genuine empty (no_task_orders / no_incumbent_uei / …) → stamp state_approx (honest).
 */
describe('resolveRecompeteMapLoc — a BQ error throws (retry), a genuine empty stamps state_approx', () => {
  const row = { contract_id: 'C1', piid: 'N0003921F3007', incumbent_uei: 'VV9KH3L99VE3', place_of_performance_state: 'VA' };

  it('THROWS TaskOrderLookupError on reason=query_error (row left NULL, NOT stamped state_approx)', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: false, reason: 'query_error', txns: [], totalActual: 0, distinctCities: 0, fromCache: false,
    });
    await expect(resolveRecompeteMapLoc(row)).rejects.toBeInstanceOf(TaskOrderLookupError);
    // A throw means the worker's catch runs → failed++ and NO .update() fires → row stays NULL.
    expect(geocodeCityMock).not.toHaveBeenCalled();
  });

  it('carries the contract id + reason on the thrown error (so the failure is attributable)', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: false, reason: 'query_error', txns: [], totalActual: 0, distinctCities: 0, fromCache: false,
    });
    await expect(resolveRecompeteMapLoc(row)).rejects.toMatchObject({
      name: 'TaskOrderLookupError', contractId: 'C1', reason: 'query_error',
    });
  });

  it('does NOT throw on a genuine empty — stamps state_approx (no_task_orders)', async () => {
    getTaskOrdersMock.mockResolvedValueOnce({
      grounded: false, reason: 'no_task_orders', txns: [], totalActual: 0, distinctCities: 0, fromCache: false,
    });
    const res = await resolveRecompeteMapLoc(row);
    expect(res.outcome).toBe('state_approx');
  });

  it('does NOT throw on the other genuine-empty reasons either (no_incumbent_uei / no_piid / collapsed_vehicle_piid)', async () => {
    for (const reason of ['no_incumbent_uei', 'no_piid', 'collapsed_vehicle_piid']) {
      getTaskOrdersMock.mockResolvedValueOnce({
        grounded: false, reason, txns: [], totalActual: 0, distinctCities: 0, fromCache: false,
      });
      const res = await resolveRecompeteMapLoc(row);
      expect(res.outcome).toBe('state_approx');
    }
  });
});
