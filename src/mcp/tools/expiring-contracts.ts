/**
 * MCP tool: get_expiring_contracts — federal contracts expiring soon (recompete
 * targets). "Who's about to lose their contract, so I can pursue the recompete."
 *
 * Wraps src/lib/recompete/query.ts (Supabase `recompete_opportunities`,
 * USASpending-derived, commodity, metered). credits: 5. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import {
  resolveVehicleOrderingEnds,
  rollupOrdersByVehicle,
  type VehicleLookup,
  type VehicleRollup,
} from '@/lib/recompete/vehicle-rollup';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ExpiringContractsToolInput {
  naics?: string;
  /** Multiple NAICS as ONE market (OR across codes) — a saved search's full code set. */
  naicsCodes?: string[];
  agency?: string;
  state?: string;
  months_window?: number;
  /**
   * Skip contracts ending sooner than this many months. The default window
   * sorts soonest-first, so the first page is the decided end (lead time
   * rounding to 0). A capture window is months_min=6, months_window=18.
   */
  months_min?: number;
  min_value?: number;
  max_value?: number;
  likelihood?: 'high' | 'medium' | 'low';
  /**
   * Set-aside codes the caller may bid ("8(a)", "SDVOSB", "WOSB", "HUBZone",
   * "SB-Total", "Full & Open"). Narrows to those PLUS contracts whose set-aside
   * is unknown — unknown is never treated as ineligible.
   */
  eligible_set_asides?: string[];
  limit?: number;
}

export interface ExpiringContractsToolResult {
  queried: Record<string, string | number>;
  /** Standalone contracts (and rows whose kind is unknown) — the recompete candidates. */
  contracts: ExpiringContract[];
  /**
   * Task/delivery orders rolled up to their parent vehicle. An order is not re-competed on its
   * own; the vehicle's ordering end is the recompete signal (UNKNOWN when not established).
   */
  vehicles: VehicleRollup[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    /** contracts.length — standalone recompete candidates returned. */
    count: number;
    /** DB rows matching the filters (standalone + orders), before rollup. Not a recompete count. */
    total: number;
    vehicle_count: number;
    orders_rolled_up: number;
    /** Vehicles whose ordering end could not be established (see each vehicle's reason). */
    vehicles_ordering_end_unknown: number;
    /** State-scoped rows withheld because their own description contradicts the PoP state. */
    pop_contested_withheld: number;
  };
}

export async function expiringContracts(
  input: ExpiringContractsToolInput,
  deps: { vehicleLookup?: VehicleLookup } = {},
): Promise<ExpiringContractsToolResult> {
  const res = await queryExpiringContracts({
    naics: input.naics,
    naicsCodes: input.naicsCodes,
    agency: input.agency,
    state: input.state,
    monthsWindow: input.months_window,
    minMonthsWindow: input.months_min,
    minValue: input.min_value,
    maxValue: input.max_value,
    likelihood: input.likelihood,
    eligibleSetAsides: input.eligible_set_asides,
    limit: input.limit,
  });
  // B2 — orders under a vehicle are rolled up, not listed as recompetes. The parent's ordering
  // end is looked up (shared award-detail fetch, cached); failures stay UNKNOWN.
  const parentIds = res.contracts
    .filter((c) => c.award_kind === 'order_under_vehicle' && c.parent_vehicle_id)
    .map((c) => c.parent_vehicle_id as string);
  const orderingEnds = parentIds.length
    ? await resolveVehicleOrderingEnds(parentIds, { lookup: deps.vehicleLookup })
    : new Map();
  const { standalone, vehicles } = rollupOrdersByVehicle(res.contracts, orderingEnds);

  const grounded = standalone.length > 0 || vehicles.length > 0;
  const queried: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({ naics: input.naics, agency: input.agency, state: input.state, months_window: input.months_window, months_min: input.months_min, likelihood: input.likelihood })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }
  const result: ExpiringContractsToolResult = {
    queried,
    contracts: standalone,
    vehicles,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: standalone.length,
      total: res.total,
      vehicle_count: vehicles.length,
      orders_rolled_up: vehicles.reduce((n, v) => n + v.orders_in_result, 0),
      vehicles_ordering_end_unknown: vehicles.filter((v) => v.ordering_end_status === 'unknown').length,
      pop_contested_withheld: res.pop_contested_withheld ?? 0,
    },
  };
  if (mcpFlags.aiHint) {
    const top = standalone[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Recompete lookup errored — retry; do not state there are no expiring contracts.'
        : grounded
        ? `${standalone.length} standalone contract(s) expiring in-window${top ? ` (soonest: ${top.incumbent_name ?? 'incumbent n/a'} @ ${top.awarding_agency ?? 'agency n/a'} ends ${top.period_of_performance_current_end ?? '?'})` : ''}; ${vehicles.length} vehicle(s) with orders flowing under them.`
        : 'No expiring contracts matched. Widen months_window or drop filters.',
      how_to_use: grounded
        ? 'contracts[] are standalone awards: incumbent_name = who to unseat; period_of_performance_current_end = the clock; potential_total_value = the prize ceiling. '
          + 'estimated_recompete_date is PoP end − 12 months only while that is still ahead; when null, recompete_date_status says why (capture_window_open = follow-on activity may already be under way, date unknown). '
          + 'vehicles[] are task/delivery orders grouped by parent vehicle — orders are NOT re-competed on their own; ordering_end_date is the vehicle\'s recompete signal, and null means unknown; ordering_period_status=closed means the vehicle already stopped taking orders (its follow-on is not established here). Present them as "work flowing under <vehicle>", a teaming/sub-under lead, never as recompetes. '
          + 'set_aside_type is the ELIGIBILITY GATE and the first thing to surface for a small business: "SB-Total"/"8(a)"/"SDVOSB"/"WOSB"/"HUBZone" mean the large primes are legally barred from bidding, while "Full & Open" means they are not. '
          + 'A small firm asking "what can I win" wants the set-aside rows, not the biggest dollar rows — a $90M Full & Open recompete held by a top-10 prime is not a target, and listing it as one reads as noise.'
        : 'No grounded contracts; say none matched rather than inventing one.',
      key_caveats: [
        'vehicles[] groups orders by the parent IDV recorded on each order. Holders of a multiple-award vehicle each hold their own IDV number, so sibling IDVs from one solicitation appear as separate vehicles; holders_in_result lists only holders seen in these rows.',
        'place_of_performance_state is the award record\'s place of performance only; null when missing or when the record\'s own description names an installation in another state (place_of_performance_state_status = contested).',
        'recompete_likelihood is an inference; some contracts get extended or not recompeted.',
        // set_aside_type is NULL on ~65% of rows (only PIIDs matched in the BQ awards
        // backfill carry it). NULL means UNKNOWN, never "Full & Open" — do not tell a
        // user a contract is open to them because the field is empty.
        'set_aside_type is only known for contracts matched in the awards backfill; NULL means unknown, NOT unrestricted.',
      ],
    };
  }
  return result;
}
