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
import { normalizeStateCode } from '@/lib/utils/us-states';
import type { IgnoredArg } from '@/lib/mcp/result-contract';

/** An order under a vehicle, listed at top level so an in-window order is never only nested. */
export type ExpiringOrderInWindow = ExpiringContract & {
  parent_vehicle_piid: string | null;
  vehicle_ordering_end_date: string | null;
  vehicle_ordering_period_status: VehicleRollup['ordering_period_status'];
};

function argTokens(raw: unknown, splitter: RegExp): string[] {
  const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return arr
    .flatMap((v) => String(v ?? '').split(splitter))
    .map((t) => t.trim())
    .filter(Boolean);
}

/** NAICS from a string, comma/space list, or array. 2-6 digits each; anything else is reported, never guessed. */
export function resolveNaicsArg(raw: unknown): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const t of argTokens(raw, /[,;\s]+/)) {
    if (/^\d{2,6}$/.test(t)) { if (!codes.includes(t)) codes.push(t); } else invalid.push(t);
  }
  return { codes, invalid };
}

/**
 * States from a code, a full name, a list ("TN, MS or AR", ["Tennessee","MS"]). Splits only on
 * , ; / & and the words " or " / " and " between spaces, so the Oregon code "OR" survives.
 */
export function resolveStateArg(raw: unknown): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const t of argTokens(raw, /\s*[,;\/&]\s*|\s+(?:or|and)\s+/i)) {
    const code = normalizeStateCode(t);
    if (code) { if (!codes.includes(code)) codes.push(code); } else invalid.push(t);
  }
  return { codes, invalid };
}

export interface ExpiringContractsToolInput {
  /** One code, a comma/space list, or an array; ≤5 digits = prefix, 6 = exact. */
  naics?: string | string[];
  /** Multiple NAICS as ONE market (OR across codes) — a saved search's full code set. */
  naicsCodes?: string[];
  agency?: string;
  /** 2-letter code or full name; several as a list or array (OR'd). */
  state?: string | string[];
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
  /**
   * Orders proven to sit under a vehicle whose parent is not recorded. Each is listed on its own
   * with parent_vehicle = 'UNKNOWN' — never a standalone recompete, never grouped into a vehicle.
   */
  unresolved_orders: Array<ExpiringContract & { parent_vehicle: 'UNKNOWN' }>;
  /**
   * Every task/delivery order ending in the window, at top level with its parent vehicle. The
   * same orders also appear inside vehicles[] (unchanged). Added because a reader that looked
   * only at contracts[] saw zero while in-window orders sat nested.
   */
  expiring_orders_in_window: ExpiringOrderInWindow[];
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
    /** Orders whose parent vehicle could not be established (listed in unresolved_orders). */
    orders_parent_unknown: number;
    /** expiring_orders_in_window.length. */
    expiring_orders_in_window: number;
    /** Every record ending in the window that this response lists: standalone + orders + unresolved orders. */
    records_in_window: number;
    /** The filters that actually shaped the query (normalized). */
    applied_filters: Record<string, unknown>;
    /** Arguments that did not shape the query, with the reason. */
    ignored_args: IgnoredArg[];
    window?: { after: string; through: string; as_of: string; months: number };
    /** Set when more rows matched than were returned. */
    incomplete_reason?: string;
    result_state?: 'filter_not_applied';
  };
}

export async function expiringContracts(
  input: ExpiringContractsToolInput,
  deps: { vehicleLookup?: VehicleLookup } = {},
): Promise<ExpiringContractsToolResult> {
  const naicsGiven = input.naicsCodes?.length ? input.naicsCodes : input.naics;
  const naicsArg = resolveNaicsArg(naicsGiven);
  const stateArg = resolveStateArg(input.state);
  const ignored: IgnoredArg[] = [];
  if (naicsArg.invalid.length) {
    ignored.push({ arg: 'naics', value: naicsArg.invalid.join(', '), reason: 'invalid_value', detail: 'NAICS must be 2-6 digits' });
  }
  if (stateArg.invalid.length) {
    ignored.push({ arg: 'state', value: stateArg.invalid.join(', '), reason: 'invalid_value', detail: 'not a recognized US state or code' });
  }
  const queried: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({
    naics: Array.isArray(input.naics) ? input.naics.join(',') : input.naics,
    agency: input.agency,
    state: Array.isArray(input.state) ? input.state.join(',') : input.state,
    months_window: input.months_window, months_min: input.months_min, likelihood: input.likelihood,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }
  // A filter whose every value was unrecognizable is NOT dropped: running without it would
  // answer a broader (national / all-industry) question and present it as this one.
  const naicsUnusable = naicsArg.invalid.length > 0 && naicsArg.codes.length === 0;
  const stateUnusable = stateArg.invalid.length > 0 && stateArg.codes.length === 0;
  if (naicsUnusable || stateUnusable) {
    return {
      queried, contracts: [], vehicles: [], unresolved_orders: [], expiring_orders_in_window: [],
      _meta: {
        grounded: false, degraded: false, count: 0, total: 0, vehicle_count: 0, orders_rolled_up: 0,
        vehicles_ordering_end_unknown: 0, orders_parent_unknown: 0, expiring_orders_in_window: 0,
        records_in_window: 0, applied_filters: {}, ignored_args: ignored, result_state: 'filter_not_applied',
      },
    };
  }
  const res = await queryExpiringContracts({
    naicsCodes: naicsArg.codes.length ? naicsArg.codes : undefined,
    agency: input.agency,
    states: stateArg.codes.length ? stateArg.codes : undefined,
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
  const { standalone, vehicles, unresolved } = rollupOrdersByVehicle(res.contracts, orderingEnds);

  const grounded = standalone.length > 0 || vehicles.length > 0 || unresolved.length > 0;
  const orderVehicle = new Map<string, VehicleRollup>();
  for (const v of vehicles) for (const o of v.orders) orderVehicle.set(o.contract_id, v);
  const expiringOrders: ExpiringOrderInWindow[] = res.contracts
    .filter((c) => orderVehicle.has(c.contract_id))
    .map((c) => {
      const v = orderVehicle.get(c.contract_id)!;
      return {
        ...c,
        parent_vehicle_piid: v.vehicle_piid,
        vehicle_ordering_end_date: v.ordering_end_date,
        vehicle_ordering_period_status: v.ordering_period_status,
      };
    });
  const applied: Record<string, unknown> = {};
  if (naicsArg.codes.length) applied.naics = naicsArg.codes;
  if (stateArg.codes.length) applied.state = stateArg.codes;
  if (input.agency) applied.agency = input.agency;
  if (res.window) applied.months_window = res.window.months;
  if (input.months_min !== undefined) applied.months_min = input.months_min;
  if (input.min_value !== undefined) applied.min_value = input.min_value;
  if (input.max_value !== undefined) applied.max_value = input.max_value;
  if (input.likelihood) applied.likelihood = input.likelihood;
  if (input.eligible_set_asides?.length) applied.eligible_set_asides = input.eligible_set_asides;
  const rowsReturned = res.contracts.length;
  const incomplete = !res.degraded && res.total > rowsReturned
    ? `returned ${rowsReturned} of ${res.total} matching records (row limit); raise limit (max 200) or narrow the filters before saying this is the full list`
    : undefined;
  const result: ExpiringContractsToolResult = {
    queried,
    contracts: standalone,
    // Listed before vehicles[] (a large nested block) so a reader does not skim past in-window orders.
    expiring_orders_in_window: expiringOrders,
    unresolved_orders: unresolved,
    vehicles,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: standalone.length,
      total: res.total,
      vehicle_count: vehicles.length,
      orders_rolled_up: vehicles.reduce((n, v) => n + v.orders_in_result, 0),
      vehicles_ordering_end_unknown: vehicles.filter((v) => v.ordering_end_status === 'unknown').length,
      orders_parent_unknown: unresolved.length,
      expiring_orders_in_window: expiringOrders.length,
      records_in_window: standalone.length + expiringOrders.length + unresolved.length,
      applied_filters: applied,
      ignored_args: ignored,
      ...(res.window ? { window: res.window } : {}),
      ...(incomplete ? { incomplete_reason: incomplete } : {}),
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
          + 'capture_start_date is a SUGGESTED capture start derived by rule (capture_start_basis: PoP end − 12 months) — say "Contract ends <end>. Suggested capture start: <date>." Never call it a recompete date. estimated_recompete_date is null: no source establishes when the follow-on will be solicited. '
          + 'unresolved_orders[] are task/delivery orders whose parent vehicle is not recorded (parent_vehicle = UNKNOWN) — not recompetes, and not grouped. '
          + 'vehicles[] are task/delivery orders grouped by parent vehicle — orders are NOT re-competed on their own; ordering_end_date is the vehicle\'s recompete signal, and null means unknown; ordering_period_status=closed means the vehicle already stopped taking orders (its follow-on is not established here). Present them as "work flowing under <vehicle>", a teaming/sub-under lead, never as recompetes. '
          + 'set_aside_type is the ELIGIBILITY GATE and the first thing to surface for a small business: "SB-Total"/"8(a)"/"SDVOSB"/"WOSB"/"HUBZone" mean the large primes are legally barred from bidding, while "Full & Open" means they are not. '
          + 'A small firm asking "what can I win" wants the set-aside rows, not the biggest dollar rows — a $90M Full & Open recompete held by a top-10 prime is not a target, and listing it as one reads as noise.'
        : 'No grounded contracts; say none matched rather than inventing one.',
      key_caveats: [
        'vehicles[] groups orders by the parent IDV recorded on each order. Holders of a multiple-award vehicle each hold their own IDV number, so sibling IDVs from one solicitation appear as separate vehicles; holders_in_result lists only holders seen in these rows.',
        'place_of_performance_state is the place of performance as reported by USASpending, shown as reported; null means USASpending reported none.',
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
