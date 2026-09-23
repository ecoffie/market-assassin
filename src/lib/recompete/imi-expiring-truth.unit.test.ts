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
 *   (7) place of performance is exposed AS REPORTED by USASpending — no free-text override and
 *       no substituted state (Eric, 2026-09-22). FA805126F0034 stays GA, as reported.
 *   (B4) a task/delivery order can never be an individual Coming Back alert card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annotateRecompeteRow, POP_SOURCE_NOTE } from './annotate';
import { parseAwardLineage } from './award-lineage';
import { rollupOrdersByVehicle, resolveVehicleOrderingEnds } from './vehicle-rollup';
import { selectComingBackRows } from '@/lib/alerts/coming-back-to-market';
import type { ExpiringContract } from './query';
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

describe('(4) capture start is not a recompete date (final contract, Eric 2026-09-22)', () => {
  it('BEFORE: the stored DB-trigger date (PoP end − 12mo) was served as the recompete date, past on most rows', () => {
    const past = inWindowRows().filter((r) => r.estimated_recompete_date && r.estimated_recompete_date < TODAY);
    // Measured on the frozen set: 55 of 59 — every row ending inside the next 12 months.
    expect(past.length).toBe(55);
    const rca = inWindowRows().find((r) => r.piid === 'FA850126F0034')!;
    expect(rca.period_of_performance_current_end).toBe('2026-11-09');
    expect(rca.estimated_recompete_date).toBe('2025-11-09');
  });

  it('AFTER: estimated_recompete_date is null on all 59 rows (0 past-dated, 0 copied from capture start or PoP end)', () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    expect(annotated.filter((r) => r.estimated_recompete_date !== null)).toEqual([]);
    for (const a of annotated) {
      expect(a.estimated_recompete_date).not.toBe(a.capture_start_date);
      expect(a.estimated_recompete_date).not.toBe(a.period_of_performance_current_end);
    }
  });

  it('carries the derived capture start with its stated rule — nothing hidden, nothing clamped to today', () => {
    const annotated = inWindowRows().map((r) => annotateRecompeteRow(r, NOW));
    for (const a of annotated) {
      expect(a.capture_start_date).toBeTruthy();
      expect(a.capture_start_basis).toBe('derived: period_of_performance_current_end − 12 months (Mindy capture lead rule)');
      expect(a.capture_start_passed).toBe(a.capture_start_date! < TODAY);
    }
    // "Contract ends 2026-11-09. Suggested capture start: 2025-11-09."
    const rca = annotated.find((r) => r.piid === 'FA850126F0034')!;
    expect(rca.period_of_performance_current_end).toBe('2026-11-09');
    expect(rca.capture_start_date).toBe('2025-11-09');
    expect(rca.estimated_recompete_date).toBeNull();
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

describe('(5c) an unknown parent never creates a vehicle', () => {
  const parentless = (piid: string) => annotateRecompeteRow({
    contract_id: piid, piid, contract_type: 'DELIVERY ORDER', incumbent_name: `Holder ${piid}`,
    awarding_agency: 'Department of Defense', awarding_sub_agency: 'Department of the Air Force',
    total_obligation: 100_000, period_of_performance_current_end: '2027-01-15', description: null,
  }, NOW);

  it('two parentless DELIVERY ORDER rows from the same agency/sub-agency do NOT become one VehicleRollup', () => {
    const rows = [parentless('FA000126F0001'), parentless('FA000126F0002')];
    expect(rows.every((r) => r.award_kind === 'order_under_vehicle' && r.parent_vehicle_piid === null)).toBe(true);
    const { standalone, vehicles, unresolved } = rollupOrdersByVehicle(rows, new Map(), NOW);
    expect(vehicles).toEqual([]);
    expect(standalone).toEqual([]);
    expect(unresolved.map((u) => u.piid)).toEqual(['FA000126F0001', 'FA000126F0002']);
    expect(unresolved.every((u) => u.parent_vehicle === 'UNKNOWN')).toBe(true);
  });

  it('parentless orders sit beside real vehicles without joining them', () => {
    const annotated = [...inWindowRows().map((r) => annotateRecompeteRow(r, NOW)), parentless('FA000126F0003')];
    const { vehicles, unresolved } = rollupOrdersByVehicle(annotated, new Map(), NOW);
    expect(vehicles.every((v) => v.vehicle_piid)).toBe(true);
    expect(unresolved.map((u) => u.piid)).toEqual(['FA000126F0003']);
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

describe('(7) place of performance is exposed as reported by USASpending — nothing substituted', () => {
  it('FA805126F0034 returns GA as reported — not FL, not null', () => {
    const raw = IMI_GA_2382_ROWS.find((r) => r.piid === 'FA805126F0034')!;
    const apex = annotateRecompeteRow(raw, NOW);
    expect(apex.place_of_performance_state).toBe('GA');
    expect(apex.place_of_performance_source_note).toBe('Place of performance as reported by USASpending.');
  });

  it('every row carries its stored place-of-performance value unchanged (no override field exists)', () => {
    for (const r of IMI_GA_2382_ROWS) {
      const a = annotateRecompeteRow(r, NOW) as Record<string, unknown>;
      expect(a.place_of_performance_state).toBe(r.place_of_performance_state);
      expect(a.place_of_performance_source_note).toBe(POP_SOURCE_NOTE);
      for (const k of ['place_of_performance_state_status', 'place_of_performance_contest', 'place_of_performance_state_reported']) {
        expect(a).not.toHaveProperty(k);
      }
    }
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
  it('returns standalone contracts + vehicles, PoP as reported, and no past estimate', async () => {
    const { expiringContracts } = await import('@/mcp/tools/expiring-contracts');
    const lookup = async (id: string) => (id === 'CONT_IDV_FA850124D0005_9700' ? IDV_DETAIL_FA850124D0005 : null);
    const res = await expiringContracts({ naics: '2382', state: 'GA', limit: 200 }, { vehicleLookup: lookup });

    // (7) the Patrick SFB order is present under its vehicle, as reported (nothing withheld).
    const apexOrder = res.vehicles.flatMap((v) => v.orders).find((o) => o.piid === 'FA805126F0034');
    expect(apexOrder).toBeDefined();
    expect(res._meta).not.toHaveProperty('pop_contested_withheld');
    // (4)
    expect(res.contracts.filter((c) => c.estimated_recompete_date !== null)).toEqual([]);
    // (5)
    expect(res.contracts.some((c) => c.award_kind === 'order_under_vehicle')).toBe(false);
    const robins = res.vehicles.find((v) => v.vehicle_piid === 'FA850124D0005')!;
    expect(robins.ordering_end_date).toBe('2029-04-23');
    expect(robins.orders).toHaveLength(5);
    // Counts reconcile: 59 rows = standalone + rolled-up orders.
    expect(res.contracts.length + res._meta.orders_rolled_up).toBe(59);
    expect(res._meta.count).toBe(res.contracts.length);
    expect(res._meta.grounded).toBe(true);
  });
});

describe('(B4) Coming Back alert cards never include task/delivery orders', () => {
  // A row the alert selector would otherwise pick: stored NAICS, 6–18 month lead window.
  const card = (over: Partial<ExpiringContract> & { contract_id: string }): ExpiringContract => ({
    piid: over.contract_id, incumbent_name: 'Incumbent', incumbent_uei: null, awarding_agency: 'Department of Defense',
    awarding_sub_agency: 'Department of the Air Force', naics_code: '238220', naics_description: null, psc_code: null,
    description: null, total_obligation: 2_000_000, potential_total_value: 2_000_000, period_of_performance_start: null,
    period_of_performance_current_end: '2027-06-01', place_of_performance_state: 'GA', place_of_performance_city: null,
    set_aside_type: null, competition_type: null, number_of_offers: null, estimated_recompete_date: null,
    lead_time_months: 9, recompete_likelihood: 'medium', ...over,
  });
  const run = (contracts: ExpiringContract[]) =>
    selectComingBackRows({ contracts, count: contracts.length, naicsCodes: ['238220'] });

  it('order_under_vehicle cannot be selected as an alert item', () => {
    const order = card({ contract_id: 'CONT_AWD_FA850126F0062_9700_FA850124D0005_9700', piid: 'FA850126F0062', contract_type: 'DELIVERY ORDER' });
    const d = run([order]);
    // No card, and no customer-facing zero/error: the section is simply omitted.
    expect(d).toEqual({ kind: 'omit', reason: 'none_qualify' });
  });

  it('a standalone contract remains eligible, and excluded orders are counted internally only', () => {
    const standalone = card({ contract_id: 'CONT_AWD_36C24726C0032_3600_-NONE-_-NONE-', piid: '36C24726C0032', contract_type: 'DEFINITIVE CONTRACT' });
    const orders = ['F0062', 'F0075', 'F0140'].map((s) =>
      card({ contract_id: `CONT_AWD_FA85012${s}_9700_FA850124D0005_9700`, piid: `FA85012${s}`, contract_type: 'DELIVERY ORDER', potential_total_value: 90_000_000 }));
    const d = run([...orders, standalone]);
    expect(d.kind).toBe('show');
    if (d.kind !== 'show') return;
    expect(d.rows.map((r) => r.contract_id)).toEqual([standalone.contract_id]);
    expect(d.ordersExcluded).toBe(3);
  });

  it('on the frozen IMI set, no selected card is an order', () => {
    const rows = inWindowRows().map((r) => annotateRecompeteRow(r, NOW)) as unknown as ExpiringContract[];
    const d = run(rows);
    if (d.kind === 'show') {
      const ids = new Set(d.rows.map((r) => r.contract_id));
      for (const r of rows) if (ids.has(r.contract_id)) expect(parseAwardLineage(r).award_kind).not.toBe('order_under_vehicle');
      expect(d.ordersExcluded).toBe(24);
    }
  });
});
