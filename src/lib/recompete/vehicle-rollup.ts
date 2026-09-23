/**
 * Order → vehicle rollup for get_expiring_contracts (IMI test, 2026-09-22).
 *
 * Orders under a live vehicle are "work flowing under X", not recompetes. The recompete signal
 * for that work is the VEHICLE's ordering end (USASpending IDV "Last Date to Order", which the
 * award detail endpoint reports as the IDV's `period_of_performance.end_date` — verified for
 * FA850124D0005: both give 2029-04-23).
 *
 * If a vehicle's ordering end cannot be established, it is UNKNOWN with a reason. We never fall
 * back to an order's own end date as the vehicle's recompete signal.
 *
 * Source reuse: `fetchAwardDetail` (src/lib/usaspending/award-detail.ts) — the same USASpending
 * award endpoint the drawer, task-order and detail-enrich paths already call. No new source.
 */
import { fetchAwardDetail, type AwardDetail } from '@/lib/usaspending/award-detail';
import { withCache } from '@/lib/mcp/external-cache';
import type { AwardKind } from './award-lineage';

export interface VehicleOrderingEnd {
  ordering_end_date: string | null;
  status: 'established' | 'unknown';
  /** Why it is unknown; null when established. */
  reason: 'no_parent_id' | 'lookup_failed' | 'not_reported' | 'lookup_budget_exhausted' | null;
  source: 'usaspending_idv_last_date_to_order' | null;
  multiple_or_single_award: string | null;
  vehicle_set_aside: string | null;
  vehicle_holder_name: string | null;
}

export type VehicleLookup = (parentVehicleId: string) => Promise<AwardDetail | null>;

const CACHE_API_TYPE = 'recompete:vehicle-ordering-end';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // an IDV's ordering end changes by modification only

/** Default lookup: the shared award-detail fetch, cached a week in mcp_external_cache. */
export const cachedVehicleLookup: VehicleLookup = async (id) => {
  const { value } = await withCache<AwardDetail | null>(CACHE_API_TYPE, { id }, CACHE_TTL_SECONDS, () => fetchAwardDetail(id));
  return value;
};

const unknown = (reason: VehicleOrderingEnd['reason']): VehicleOrderingEnd => ({
  ordering_end_date: null, status: 'unknown', reason, source: null,
  multiple_or_single_award: null, vehicle_set_aside: null, vehicle_holder_name: null,
});

/**
 * Resolve ordering ends for distinct parent vehicles. Bounded: at most `maxLookups` parents,
 * `concurrency` at a time, inside `budgetMs`. Anything not resolved inside the bounds is
 * UNKNOWN with the reason, never guessed.
 */
export async function resolveVehicleOrderingEnds(
  parentIds: string[],
  opts: { lookup?: VehicleLookup; maxLookups?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<Map<string, VehicleOrderingEnd>> {
  const lookup = opts.lookup ?? cachedVehicleLookup;
  const maxLookups = opts.maxLookups ?? 25;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const deadline = Date.now() + (opts.budgetMs ?? 4_000);
  const out = new Map<string, VehicleOrderingEnd>();
  const distinct = Array.from(new Set(parentIds.filter(Boolean)));
  const queue = distinct.slice(0, maxLookups);
  for (const id of distinct.slice(maxLookups)) out.set(id, unknown('lookup_budget_exhausted'));

  const one = async (id: string): Promise<VehicleOrderingEnd> => {
    if (!/^CONT_IDV_/i.test(id)) return unknown('no_parent_id');
    let d: AwardDetail | null = null;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return unknown('lookup_budget_exhausted');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        d = await Promise.race([
          lookup(id),
          new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), remaining); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      return unknown('lookup_failed');
    }
    if (!d) return unknown(Date.now() >= deadline ? 'lookup_budget_exhausted' : 'lookup_failed');
    const end = String(d.popEnd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return { ...unknown('not_reported'), multiple_or_single_award: d.multipleOrSingleAward ?? null, vehicle_set_aside: d.setAsideDescription ?? null, vehicle_holder_name: d.recipientName || null };
    }
    return {
      ordering_end_date: end,
      status: 'established',
      reason: null,
      source: 'usaspending_idv_last_date_to_order',
      multiple_or_single_award: d.multipleOrSingleAward ?? null,
      vehicle_set_aside: d.setAsideDescription ?? null,
      vehicle_holder_name: d.recipientName || null,
    };
  };

  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (i < queue.length) {
      const id = queue[i++];
      out.set(id, await one(id));
    }
  });
  await Promise.all(workers);
  return out;
}

export interface RolledUpOrder {
  piid: string | null;
  contract_id: string;
  incumbent_name: string | null;
  period_of_performance_current_end: string | null;
  total_obligation: number | null;
  description: string | null;
}

export interface VehicleRollup {
  /** Parent IDV/BPA PIID, or null when the orders' parent is not recorded. */
  vehicle_piid: string | null;
  vehicle_id: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  /** The vehicle's recompete signal: its last date to order. NULL = unknown (see status). */
  ordering_end_date: string | null;
  ordering_end_status: 'established' | 'unknown';
  ordering_end_reason: VehicleOrderingEnd['reason'];
  ordering_end_source: VehicleOrderingEnd['source'];
  /**
   * open   — ordering end is today or later: new orders can still be placed under this vehicle.
   * closed — ordering end has passed: these orders are the tail of a vehicle that can no longer
   *          take new orders. Its follow-on is not established by this data (measured live
   *          2026-09-23: 3 of 15 GA 2382 vehicles, e.g. DTFAAC16D00019 closed 2021-05-03).
   * unknown — ordering end not established.
   */
  ordering_period_status: 'open' | 'closed' | 'unknown';
  multiple_or_single_award: string | null;
  vehicle_set_aside: string | null;
  /** The IDV's own recipient as USASpending reports it (null when not looked up). */
  vehicle_holder_name: string | null;
  /** Holders seen on the orders in this result (not the vehicle's full holder list). */
  holders_in_result: string[];
  orders_in_result: number;
  orders_obligated_in_result: number;
  orders: RolledUpOrder[];
  /** Always the same sentence: these orders are work under the vehicle, not recompetes. */
  semantics: 'orders_flowing_under_vehicle';
}

type RollupRow = {
  contract_id: string;
  piid: string | null;
  incumbent_name: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  total_obligation: number | null;
  period_of_performance_current_end: string | null;
  description: string | null;
  award_kind?: AwardKind;
  parent_vehicle_piid?: string | null;
  parent_vehicle_id?: string | null;
};

/**
 * Split annotated rows into standalone recompete candidates and vehicles (orders grouped by
 * parent). Orders with no recorded parent are grouped under one `vehicle_piid: null` bucket per
 * agency — still not presented as standalone recompetes. Pure given `orderingEnds`.
 */
export function rollupOrdersByVehicle<T extends RollupRow>(
  rows: T[],
  orderingEnds: Map<string, VehicleOrderingEnd>,
  now: Date = new Date(),
): { standalone: T[]; vehicles: VehicleRollup[] } {
  const today = now.toISOString().slice(0, 10);
  const standalone: T[] = [];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (r.award_kind !== 'order_under_vehicle') { standalone.push(r); continue; }
    const key = r.parent_vehicle_id || r.parent_vehicle_piid || `unrecorded|${r.awarding_agency || ''}|${r.awarding_sub_agency || ''}`;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }
  const vehicles: VehicleRollup[] = [];
  for (const members of groups.values()) {
    const lead = members[0];
    const vid = lead.parent_vehicle_id ?? null;
    const oe = vid ? orderingEnds.get(vid) ?? unknown('lookup_failed') : unknown('no_parent_id');
    const holders = Array.from(new Set(members.map((m) => (m.incumbent_name || '').trim()).filter(Boolean)));
    vehicles.push({
      vehicle_piid: lead.parent_vehicle_piid ?? null,
      vehicle_id: vid,
      awarding_agency: lead.awarding_agency,
      awarding_sub_agency: lead.awarding_sub_agency,
      ordering_end_date: oe.ordering_end_date,
      ordering_end_status: oe.status,
      ordering_end_reason: oe.reason,
      ordering_end_source: oe.source,
      ordering_period_status: !oe.ordering_end_date ? 'unknown' : oe.ordering_end_date >= today ? 'open' : 'closed',
      multiple_or_single_award: oe.multiple_or_single_award,
      vehicle_set_aside: oe.vehicle_set_aside,
      vehicle_holder_name: oe.vehicle_holder_name,
      holders_in_result: holders,
      orders_in_result: members.length,
      orders_obligated_in_result: members.reduce((n, m) => n + (Number(m.total_obligation) || 0), 0),
      orders: members.map((m) => ({
        piid: m.piid,
        contract_id: m.contract_id,
        incumbent_name: m.incumbent_name,
        period_of_performance_current_end: m.period_of_performance_current_end,
        total_obligation: m.total_obligation,
        description: m.description,
      })),
      semantics: 'orders_flowing_under_vehicle',
    });
  }
  // Soonest known ordering end first; unknown ordering ends last (never sorted as "soon").
  vehicles.sort((a, b) => {
    if (a.ordering_end_date && b.ordering_end_date) return a.ordering_end_date.localeCompare(b.ordering_end_date);
    if (a.ordering_end_date) return -1;
    if (b.ordering_end_date) return 1;
    return b.orders_in_result - a.orders_in_result;
  });
  return { standalone, vehicles };
}
