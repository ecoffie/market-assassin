/**
 * IMI test (2026-09-22) — get_expiring_contracts truth, Workstream B.
 *
 * Frozen set: src/lib/recompete/__fixtures__/imi-expiring-ga-2382.* (production rows captured
 * read-only on the IMI run date; clock pinned to FROZEN_NOW).
 *
 * Required checks from the IMI report:
 *   (4) no contract that has not ended carries an estimated recompete date already in the past;
 *   (5) RCA's orders under FA8501-24-D-0005 appear under that ONE vehicle (ordering end
 *       2029-04-23), not as separate recompetes;
 *   (7) FA805126F0034 (HVAC at Patrick SFB) is not tagged GA, and the state a row DOES assert
 *       came from the place-of-performance field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annotateRecompeteRow } from './annotate';
import { parseAwardLineage } from './award-lineage';
import { namedInstallations, resolvePlaceOfPerformance } from './pop-integrity';
import { rollupOrdersByVehicle, resolveVehicleOrderingEnds } from './vehicle-rollup';
import { AWARD_GROUPS, fetchExpiringForNaics } from './usaspending-sync';
import {
  FROZEN_NOW,
  IDV_DETAIL_FA850124D0005,
  IMI_GA_2382_ROWS,
  inWindowRows,
} from './__fixtures__/imi-expiring-ga-2382';

const NOW = new Date(FROZEN_NOW);
const TODAY = FROZEN_NOW.slice(0, 10);

// Hermetic stand-in for the Supabase query builder: every filter is chainable, `.limit()` resolves
// with the frozen in-window rows (the fixture helper already applies the tool's own predicate).
const sb = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'lte', 'gt', 'gte', 'is', 'like', 'eq', 'or', 'order']) b[m] = () => b;
    b.limit = async () => ({ data: sb.rows, count: sb.rows.length, error: null });
    return b;
  },
}));

// No fake timers: every pure helper takes an explicit `now` (NOW). The tool-level test runs on the
// real clock over rows already selected for FROZEN_NOW; its assertions hold for any later date
// (estimates only ever move from "a date ≥ today" to null as time passes).
beforeEach(() => {
  sb.rows = inWindowRows();
});
afterEach(() => {
  sb.rows = [];
});

describe('frozen set sanity', () => {
  it('is the captured population the IMI call ran against', () => {
    expect(IMI_GA_2382_ROWS).toHaveLength(77);
    expect(inWindowRows()).toHaveLength(59);
  });
});

describe('(4) recompete date is never already past for a contract that has not ended', () => {
  it('BEFORE: the stored DB-trigger date was in the past on most in-window rows', () => {
    const past = inWindowRows().filter((r) => r.estimated_recompete_date && r.estimated_recompete_date < TODAY);
    // Measured on the frozen set: 55 of 59 — every row ending inside the next 12 months.
    expect(past.length).toBe(55);
    const rca = inWindowRows().find((r) => r.piid === 'FA850126F0034')!;
    expect(rca.period_of_performance_current_end).toBe('2026-11-09');
    expect(rca.estimated_recompete_date).toBe('2025-11-09');
  });

  it('AFTER: 0 of 59 annotated rows carry an estimated_recompete_date earlier than today', () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    const past = annotated.filter((r) => r.estimated_recompete_date && r.estimated_recompete_date < TODAY);
    expect(past).toEqual([]);
  });

  it('keeps the measured capture date under its own name — nothing hidden, nothing clamped to today', () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    for (const a of annotated) {
      expect(a.capture_start_date).toBeTruthy();
      expect(a.estimated_recompete_date).not.toBe(TODAY);
      if (a.award_kind !== 'order_under_vehicle' && a.capture_start_date! >= TODAY) {
        expect(a.estimated_recompete_date).toBe(a.capture_start_date);
        expect(a.recompete_date_status).toBe('capture_start_upcoming');
      }
    }
    const rca = annotated.find((r) => r.piid === 'FA850126F0034')!;
    expect(rca.capture_start_date).toBe('2025-11-09');
    expect(rca.estimated_recompete_date).toBeNull();
    expect(rca.recompete_date_status).toBe('order_under_vehicle');
  });

  it('a standalone contract whose capture date passed says the window is open, with no date', () => {
    const standalone = inWindowRows()
      .map((r) => annotateRecompeteRow(r, NOW))
      .find((r) => r.award_kind === 'standalone_contract' && r.capture_start_date! < TODAY)!;
    expect(standalone.estimated_recompete_date).toBeNull();
    expect(standalone.recompete_date_status).toBe('capture_window_open');
  });
});

describe('(5) orders roll up to the parent vehicle', () => {
  it('parses the parent IDV from the stored generated award id — no new source', () => {
    expect(parseAwardLineage({ contract_id: 'CONT_AWD_FA850126F0034_9700_FA850124D0005_9700' })).toEqual({
      award_kind: 'order_under_vehicle',
      parent_vehicle_piid: 'FA850124D0005',
      parent_vehicle_id: 'CONT_IDV_FA850124D0005_9700',
      lineage_source: 'contract_id',
    });
    expect(parseAwardLineage({ contract_id: 'CONT_AWD_36C24726C0032_3600_-NONE-_-NONE-' }).award_kind).toBe('standalone_contract');
    // Raw-PIID contract ids fall back to the stored award type; nothing invented.
    expect(parseAwardLineage({ contract_id: 'GS06P11GXD0050', contract_type: 'DELIVERY ORDER' })).toMatchObject({
      award_kind: 'order_under_vehicle', parent_vehicle_piid: null, lineage_source: 'contract_type',
    });
    expect(parseAwardLineage({ contract_id: 'X', contract_type: null }).award_kind).toBe('unknown');
  });

  it('BEFORE: the in-window set listed orders as standalone rows', () => {
    const orders = inWindowRows().filter((r) => r.contract_type === 'DELIVERY ORDER');
    expect(orders.length).toBe(24);
    const rcaOrders = inWindowRows().filter((r) => r.contract_id.includes('_FA850124D0005_'));
    expect(rcaOrders.map((r) => r.piid).sort()).toEqual(['FA850125F0140', 'FA850125F0151', 'FA850126F0034', 'FA850126F0062', 'FA850126F0075']);
  });

  it('AFTER: RCA orders sit under FA8501-24-D-0005 with ordering end 2029-04-23, and no order is standalone', async () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    const lookup = vi.fn(async (id: string) => (id === 'CONT_IDV_FA850124D0005_9700' ? IDV_DETAIL_FA850124D0005 : null));
    const parents = annotated.filter((r) => r.parent_vehicle_id).map((r) => r.parent_vehicle_id as string);
    const ends = await resolveVehicleOrderingEnds(parents, { lookup });
    const { standalone, vehicles } = rollupOrdersByVehicle(annotated, ends);

    expect(standalone.some((r) => r.award_kind === 'order_under_vehicle')).toBe(false);
    const robins = vehicles.find((v) => v.vehicle_piid === 'FA850124D0005')!;
    expect(robins).toBeDefined();
    expect(robins.orders.map((o) => o.piid).sort()).toEqual(['FA850125F0140', 'FA850125F0151', 'FA850126F0034', 'FA850126F0062', 'FA850126F0075']);
    expect(robins.ordering_end_date).toBe('2029-04-23');
    expect(robins.ordering_end_status).toBe('established');
    expect(robins.ordering_end_source).toBe('usaspending_idv_last_date_to_order');
    expect(robins.holders_in_result).toEqual(['RCA CONTRACTING, INC.']);
    expect(robins.ordering_period_status).toBe('open');
    expect(robins.semantics).toBe('orders_flowing_under_vehicle');
    // Distinct parents only — one lookup per vehicle, never per order.
    expect(new Set(lookup.mock.calls.map((c) => c[0])).size).toBe(lookup.mock.calls.length);
  });

  it('a vehicle whose ordering end cannot be established is UNKNOWN — never the order\'s own end date', async () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    const parents = annotated.filter((r) => r.parent_vehicle_id).map((r) => r.parent_vehicle_id as string);
    const ends = await resolveVehicleOrderingEnds(parents, { lookup: async () => null });
    const { vehicles } = rollupOrdersByVehicle(annotated, ends);
    expect(vehicles.length).toBeGreaterThan(0);
    for (const v of vehicles) {
      expect(v.ordering_end_date).toBeNull();
      expect(v.ordering_end_status).toBe('unknown');
      expect(v.ordering_period_status).toBe('unknown');
      expect(v.ordering_end_reason).toBeTruthy();
      for (const o of v.orders) expect(v.ordering_end_date).not.toBe(o.period_of_performance_current_end);
    }
  });
});

describe('(5b) a vehicle whose ordering period already ended is labelled closed, not upcoming', () => {
  it('reads the ordering end as recorded and flags it closed', async () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    // Live 2026-09-23: DTFAAC16D00019 (FAA) stopped taking orders 2021-05-03 while an order under
    // it still performs to 2027-03-18.
    const lookup = async (id: string) =>
      id === 'CONT_IDV_DTFAAC16D00019_6920' ? { ...IDV_DETAIL_FA850124D0005, generatedId: id, popEnd: '2021-05-03' } : null;
    const parents = annotated.filter((r) => r.parent_vehicle_id).map((r) => r.parent_vehicle_id as string);
    const { vehicles } = rollupOrdersByVehicle(annotated, await resolveVehicleOrderingEnds(parents, { lookup }), NOW);
    const faa = vehicles.find((v) => v.vehicle_piid === 'DTFAAC16D00019')!;
    expect(faa.ordering_end_date).toBe('2021-05-03');
    expect(faa.ordering_period_status).toBe('closed');
  });
});

describe('(7) place of performance is the PoP field or nothing', () => {
  it('BEFORE: FA805126F0034 was stored as GA (FPDS entered the awardee address as PoP)', () => {
    const apex = IMI_GA_2382_ROWS.find((r) => r.piid === 'FA805126F0034')!;
    expect(apex.place_of_performance_state).toBe('GA');
    expect(apex.description).toMatch(/PATRICK SFB/);
  });

  it('AFTER: the row is not tagged GA — the contradiction withdraws the state, it does not substitute FL', () => {
    const apex = annotateRecompeteRow(IMI_GA_2382_ROWS.find((r) => r.piid === 'FA805126F0034')!, NOW);
    expect(apex.place_of_performance_state).not.toBe('GA');
    expect(apex.place_of_performance_state).toBeNull();
    expect(apex.place_of_performance_state_status).toBe('contested');
    expect(apex.place_of_performance_state_reported).toBe('GA');
    expect(apex.place_of_performance_contest).toEqual({ named_installations: ['PATRICK SFB'], installation_state: 'FL' });
  });

  it('every asserted state equals the stored place-of-performance column and names that source', () => {
    for (const r of IMI_GA_2382_ROWS) {
      const a = annotateRecompeteRow(r, NOW);
      if (a.place_of_performance_state === null) continue;
      expect(a.place_of_performance_state).toBe(r.place_of_performance_state);
      expect(a.place_of_performance_state_source).toBe('usaspending_place_of_performance_state_code');
    }
  });

  it('a description naming an installation IN the PoP state, or none, leaves the PoP state alone', () => {
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'GA', description: 'REPAIRS AT MOODY AFB' }).state).toBe('GA');
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'GA', description: 'WORK AT ROBINS AFB' }).state).toBe('GA'); // not in table → no verdict
    expect(resolvePlaceOfPerformance({ place_of_performance_state: null, description: 'AT PATRICK SFB' })).toMatchObject({ state: null, status: 'missing' });
    // Two installations in different states: not a contradiction of either.
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'GA', description: 'MOODY AFB AND PATRICK SFB' }).status).toBe('reported');
    expect(namedInstallations('HVAC ... (PWS) AT PATRICK SFB.')).toEqual([{ name: 'PATRICK SFB', state: 'FL' }]);
  });

  it('multi-site or self-naming descriptions never withdraw (live false-positive shapes, 2026-09-23)', () => {
    // Vance AFB (OK) is not in the table; only Laughlin (TX) resolves — still two sites.
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'OK', description: 'ENVIRONMENTAL ASSESSMENT (EA)FOR MO AREAS AT VANCE AFB, OK AND LAUGHLIN AFB, TX' }).status).toBe('reported');
    // Another installation form + plural wording.
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'FL', description: 'AIRFIELD DAMAGE REPAIR EQUIPMENT, DELIVERY LOCATIONS: EIELSON AIR FORCE BASE, JOINT BASE ELMENDORF RICHARDSON' }).status).toBe('reported');
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'MA', description: 'DELIVER AND INSTALL EQUIPMENT TO TWO CONUS BASES INCLUDING MINOT AFB' }).status).toBe('reported');
    // The text names the reported state too.
    expect(resolvePlaceOfPerformance({ place_of_performance_state: 'GA', description: 'SUPPORT FROM ATLANTA, GEORGIA FOR PATRICK SFB' }).status).toBe('reported');
  });

  it('the sync writes place_of_performance_state from the PoP field only — never recipient/office', async () => {
    const requested = new Set<string>();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      for (const f of body.fields) requested.add(f);
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          results: [{
            'Award ID': 'FA805126F0034', 'Recipient Name': 'APEX FSE JV LLC', 'Recipient UEI': 'PZNLVGANJ3U3',
            'Awarding Agency': 'Department of Defense', 'Award Amount': 157000, 'End Date': '2026-10-28',
            'NAICS Code': '238220', 'Place of Performance State Code': 'FL',
            // Present in the payload to prove it is ignored even if the API ever returned it.
            'Recipient State Code': 'GA',
            generated_internal_id: 'CONT_AWD_FA805126F0034_9700_FA805126D0001_9700',
          }],
          page_metadata: { hasNext: false },
        }),
      } as unknown as Response;
    });
    const { contracts } = await fetchExpiringForNaics({ naics: '238220', monthsAhead: 18, minValue: 0, fetchImpl, pageDelayMs: 0 });
    expect(contracts[0].place_of_performance_state).toBe('FL');
    expect([...requested].filter((f) => /state/i.test(f))).toEqual(['Place of Performance State Code']);
    expect(AWARD_GROUPS.contracts.officeField).toBe('Awarding Office Name');
  });
});

describe('get_expiring_contracts (tool) on the frozen set', () => {
  it('returns standalone contracts + vehicles, withholds the contested GA row, and no past estimate', async () => {
    const { expiringContracts } = await import('@/mcp/tools/expiring-contracts');
    const lookup = async (id: string) => (id === 'CONT_IDV_FA850124D0005_9700' ? IDV_DETAIL_FA850124D0005 : null);
    const res = await expiringContracts({ naics: '2382', state: 'GA', limit: 200 }, { vehicleLookup: lookup });

    // (7) the Patrick SFB row is withheld from a GA result, and counted.
    const allPiids = [...res.contracts.map((c) => c.piid), ...res.vehicles.flatMap((v) => v.orders.map((o) => o.piid))];
    expect(allPiids).not.toContain('FA805126F0034');
    expect(res._meta.pop_contested_withheld).toBe(1);
    // (4)
    expect(res.contracts.filter((c) => c.estimated_recompete_date && c.estimated_recompete_date < TODAY)).toEqual([]);
    // (5)
    expect(res.contracts.some((c) => c.award_kind === 'order_under_vehicle')).toBe(false);
    const robins = res.vehicles.find((v) => v.vehicle_piid === 'FA850124D0005')!;
    expect(robins.ordering_end_date).toBe('2029-04-23');
    expect(robins.orders).toHaveLength(5);
    // Counts reconcile: 59 rows = standalone + rolled-up orders + withheld.
    expect(res.contracts.length + res._meta.orders_rolled_up + res._meta.pop_contested_withheld).toBe(59);
    expect(res._meta.count).toBe(res.contracts.length);
    expect(res._meta.grounded).toBe(true);
  });
});
