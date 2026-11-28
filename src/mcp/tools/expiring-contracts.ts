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
import {
  competitionFactsFor,
  competitionCounts,
  usaspendingCompetitionLookup,
  type CompetitionFacts,
  type CompetitionLookup,
} from '@/lib/opportunities/competition-facts';

/**
 * At most this many rows get a competition lookup per call (USASpending award record, cached 7 days). The rest read
 * `competition: null` + `_meta.competition.not_checked` — not looked up, never "unknown" or zero.
 */
export const COMPETITION_LOOKUP_CAP = 50;

/** An order under a vehicle, listed at top level so an in-window order is never only nested. */
/**
 * How the CURRENT award was competed, from that award's own USASpending record (competition-facts.ts).
 * `recompete_opportunities.competition_type` / `number_of_offers` are never written by the live sync (0% filled,
 * Agent 4 / Eric 2026-11-27: 15 of 15 VA HVAC rows empty), so these come from the award record instead.
 */
export type WithCompetition = {
  competition?: CompetitionFacts | null;
  /** checked = looked up (see competition.class); not_checked = past the lookup cap or budget — never "not reported". */
  competition_status?: 'checked' | 'not_checked';
  /** Which record filled set_aside_type / number_of_offers / competition_type when the stored row had none. */
  competition_fields_source?: 'usaspending_award' | 'usaspending_parent_idv' | null;
  /** Where number_of_offers came from. usaspending_parent_idv = offers on the parent VEHICLE, not on this order. */
  number_of_offers_source?: 'stored' | 'usaspending_award' | 'usaspending_parent_idv' | null;
  /**
   * Potential end if every option is exercised, from the award's own record. period_of_performance_current_end is the
   * CURRENT period (base + exercised options): a base period ending soon with options to a later year is not the
   * contract's end. null = not checked or not reported.
   */
  period_of_performance_potential_end?: string | null;
  /** Current period end as the award record reports it today (the stored current end can lag the record). */
  period_of_performance_current_end_record?: string | null;
  /** usaspending_award = place city/state filled from the award's own record because the stored row had none. */
  place_of_performance_source?: 'stored' | 'usaspending_award' | null;
};

/** Short set-aside label from the award record's own value (the same vocabulary as the stored set_aside_type). */
export function setAsideLabelFromRecord(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/no set.?aside used/i.test(s)) return 'Full & Open (no set-aside)';
  if (/8\s*\(?a\)?\s*sole source/i.test(s)) return '8(a) Sole Source';
  if (/8\s*\(?a\)?/i.test(s)) return '8(a)';
  if (/service[- ]disabled/i.test(s)) return 'SDVOSB';
  if (/hubzone/i.test(s)) return 'HUBZone';
  if (/economically disadvantaged wom/i.test(s)) return 'EDWOSB';
  if (/wom[ae]n/i.test(s)) return 'WOSB';
  if (/partial small business/i.test(s)) return 'SB-Partial';
  if (/small business set.?aside\s*-\s*total|total small business/i.test(s)) return 'SB-Total';
  if (/veteran/i.test(s)) return 'VOSB';
  return s;
}

/**
 * Fill the stored row's empty competition columns from the award record that was looked up (unknown stays null).
 * The stored set_aside_type / number_of_offers / competition_type are never overwritten when they hold a value.
 */
export function fillCompetitionColumns<T extends ExpiringContract & WithCompetition>(row: T): T {
  const c = row.competition;
  if (!c || c.source === 'none') return { ...row, competition_fields_source: null };
  const out = { ...row } as T;
  let filled = false;
  if (out.set_aside_type == null && c.set_aside_reported) { out.set_aside_type = setAsideLabelFromRecord(c.set_aside_reported); filled = true; }
  if (out.number_of_offers != null) out.number_of_offers_source = 'stored';
  else if (c.offers_received != null) { out.number_of_offers = c.offers_received; out.number_of_offers_source = c.offers_source ?? c.source; filled = true; }
  else out.number_of_offers_source = null;
  if (out.competition_type == null && c.extent_competed) { out.competition_type = c.extent_competed; filled = true; }
  out.competition_fields_source = filled ? c.source : null;
  return fillAwardRecordFields(out);
}

/**
 * Place of performance and period ends from the award's OWN record (never a parent vehicle's). A stored value is kept;
 * an empty one is filled and labelled. Unreported stays null.
 */
export function fillAwardRecordFields<T extends ExpiringContract & WithCompetition>(row: T): T {
  const r = row.competition?.award_record;
  const out = { ...row } as T;
  out.period_of_performance_potential_end = r?.period_potential_end ?? null;
  out.period_of_performance_current_end_record = r?.period_current_end ?? null;
  const hadPlace = !!(out.place_of_performance_city || out.place_of_performance_state);
  let filledPlace = false;
  if (!out.place_of_performance_city && r?.place_of_performance_city) { out.place_of_performance_city = r.place_of_performance_city; filledPlace = true; }
  if (!out.place_of_performance_state && r?.place_of_performance_state) { out.place_of_performance_state = r.place_of_performance_state; filledPlace = true; }
  out.place_of_performance_source = filledPlace ? 'usaspending_award' : hadPlace ? 'stored' : null;
  return out;
}

export type ExpiringOrderInWindow = ExpiringContract & WithCompetition & {
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
  contracts: Array<ExpiringContract & WithCompetition>;
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
    /**
     * Competition lookup coverage (only when the caller asked for it). checked = rows looked up; not_checked = rows
     * past COMPETITION_LOOKUP_CAP (competition: null). unknown = looked up but not established. Offers received is
     * reported only where the award record carries it: null means NOT REPORTED, never one bidder and never zero.
     */
    competition?: {
      source: 'usaspending_award'; checked: number; not_checked: number; competed: number; not_competed: number; unknown: number;
      offers_reported: number; set_aside_reported: number; from_parent_vehicle: number;
      /** Rows whose offer count is the parent VEHICLE's (the order's own record had none). */
      offers_from_parent_vehicle: number;
      /** Cite this line: "Competition checked on X of Y …; offers reported on N …". */
      coverage_line: string;
    };
  };
}

export async function expiringContracts(
  input: ExpiringContractsToolInput,
  deps: {
    vehicleLookup?: VehicleLookup;
    /** Attach how each returned award was competed. Off by default (report/match callers keep their latency). */
    competition?: boolean | { lookup?: CompetitionLookup; budgetMs?: number };
  } = {},
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
  // Competition: the returned standalone contracts first, then in-window orders, capped.
  let competitionMeta: ExpiringContractsToolResult['_meta']['competition'];
  let withCompetition: Array<ExpiringContract & WithCompetition> = standalone;
  let ordersOut: ExpiringOrderInWindow[] = expiringOrders;
  if (deps.competition) {
    const opt = typeof deps.competition === 'object' ? deps.competition : {};
    const candidates = [...standalone, ...expiringOrders].map((c) => c.contract_id).filter(Boolean) as string[];
    const toCheck = [...new Set(candidates)].slice(0, COMPETITION_LOOKUP_CAP);
    const lookup = opt.lookup ?? usaspendingCompetitionLookup;
    const started = Date.now();
    const budgetMs = opt.budgetMs ?? 10_000;
    const facts = await competitionFactsFor(toCheck, lookup, { budgetMs });
    // Orders whose own record leaves competition OR the offer count unestablished: read the parent vehicle's record
    // (same budget). Previously only class=unknown orders were sent, so an order classed from its own record but
    // missing its offer count never got the vehicle's count — offers appeared on some orders and not others.
    const orderParent = new Map(expiringOrders.filter((o) => o.parent_vehicle_id).map((o) => [o.contract_id, o.parent_vehicle_id as string]));
    const needParent = [...facts].filter(([id, f]) => (f.class === 'unknown' || f.offers_received == null) && orderParent.has(id)).map(([id]) => id);
    const remaining = budgetMs - (Date.now() - started);
    if (needParent.length && remaining > 500) {
      const parents = await competitionFactsFor([...new Set(needParent.map((id) => orderParent.get(id)!))], lookup, { budgetMs: remaining });
      for (const id of needParent) {
        const own = facts.get(id)!;
        const p = parents.get(orderParent.get(id)!);
        if (!p || p.source === 'none') continue;
        if (own.class === 'unknown' && p.class !== 'unknown') {
          // Competition from the vehicle; place and period stay the ORDER's own.
          facts.set(id, { ...p, source: 'usaspending_parent_idv', offers_source: p.offers_received != null ? 'usaspending_parent_idv' : null, award_record: own.award_record ?? null, order_fair_opportunity: own.order_fair_opportunity ?? null, order_competed_among_holders: own.order_competed_among_holders ?? null, detail: `${p.detail} (read from the parent vehicle's record; the order's own record did not state it).` });
        } else if (own.offers_received == null && p.offers_received != null) {
          facts.set(id, { ...own, offers_received: p.offers_received, offers_source: 'usaspending_parent_idv' });
        }
      }
    }
    const attach = <T extends ExpiringContract>(c: T): T & WithCompetition => {
      const f = facts.get(c.contract_id);
      return fillCompetitionColumns({ ...c, competition: f ?? null, competition_status: f ? 'checked' as const : 'not_checked' as const });
    };
    withCompetition = standalone.map(attach);
    ordersOut = expiringOrders.map(attach);
    const counts = competitionCounts(facts.values());
    const allIds = new Set(candidates);
    const offersReported = [...facts.values()].filter((f) => f.offers_received != null).length;
    const setAsideReported = [...facts.values()].filter((f) => f.set_aside_reported != null).length;
    const notChecked = allIds.size - facts.size;
    const offersFromParent = [...facts.values()].filter((f) => f.offers_source === 'usaspending_parent_idv').length;
    competitionMeta = {
      source: 'usaspending_award',
      checked: facts.size,
      not_checked: notChecked,
      ...counts,
      offers_reported: offersReported,
      set_aside_reported: setAsideReported,
      from_parent_vehicle: [...facts.values()].filter((f) => f.source === 'usaspending_parent_idv').length,
      offers_from_parent_vehicle: offersFromParent,
      coverage_line: `Competition checked on ${facts.size} of ${allIds.size} contracts; offers reported on ${offersReported}${offersFromParent ? ` (${offersFromParent} from the parent vehicle)` : ''}, set-aside reported on ${setAsideReported}${notChecked ? `; ${notChecked} not checked (lookup cap)` : ''}.`,
    };
  }
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
    contracts: withCompetition,
    // Listed before vehicles[] (a large nested block) so a reader does not skim past in-window orders.
    expiring_orders_in_window: ordersOut,
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
      ...(competitionMeta ? { competition: competitionMeta } : {}),
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
        ? 'contracts[] are standalone awards: incumbent_name = who to unseat; period_of_performance_current_end = the current period end (the clock); period_of_performance_potential_end = the end if every option is exercised — a base period ending soon with options running later is not the contract\'s end; total_obligation = dollars obligated to date; potential_total_value = the award ceiling ONLY when a source reported one (ceiling_basis=source_reported) — null with ceiling_basis=not_established means the ceiling is unknown here, never that it equals the obligation; get_award_detail returns the award record\'s ceiling. '
          + 'capture_start_date is a SUGGESTED capture start derived by rule (capture_start_basis: PoP end − 12 months) — say "Contract ends <end>. Suggested capture start: <date>." Never call it a recompete date. estimated_recompete_date is null: no source establishes when the follow-on will be solicited. '
          + 'unresolved_orders[] are task/delivery orders whose parent vehicle is not recorded (parent_vehicle = UNKNOWN) — not recompetes, and not grouped. '
          + 'vehicles[] are task/delivery orders grouped by parent vehicle — orders are NOT re-competed on their own; ordering_end_date is the vehicle\'s recompete signal, and null means unknown; ordering_period_status=closed means the vehicle already stopped taking orders (its follow-on is not established here). Present them as "work flowing under <vehicle>", a teaming/sub-under lead, never as recompetes. '
          + 'set_aside_type is the ELIGIBILITY GATE and the first thing to surface for a small business: "SB-Total"/"8(a)"/"SDVOSB"/"WOSB"/"HUBZone" mean the large primes are legally barred from bidding, while "Full & Open" means they are not. '
          + 'A small firm asking "what can I win" wants the set-aside rows, not the biggest dollar rows — a $90M Full & Open recompete held by a top-10 prime is not a target, and listing it as one reads as noise.'
        : 'No grounded contracts; say none matched rather than inventing one.',
      key_caveats: [
        'vehicles[] groups orders by the parent IDV recorded on each order. Holders of a multiple-award vehicle each hold their own IDV number, so sibling IDVs from one solicitation appear as separate vehicles; holders_in_result lists only holders seen in these rows.',
        'competition.order_competed_among_holders (orders): false = this order was issued under a fair-opportunity exception (competition.order_fair_opportunity names it) even when class=competed (the vehicle was competed); null = not reported.',
        'place_of_performance_state / place_of_performance_city are the place of performance as reported by USASpending (place_of_performance_source=usaspending_award when filled from the award record); null means not reported or not checked.',
        'recompete_likelihood is an inference; some contracts get extended or not recompeted.',
        'competition is read from each award\'s own USASpending record (orders fall back to the parent vehicle, competition.source=usaspending_parent_idv): class competed | not_competed | unknown. set_aside_type / number_of_offers / competition_type are filled from that record when the stored row had none (competition_fields_source). number_of_offers null = NOT REPORTED on the award, never "1 bidder" or zero. competition_status=not_checked = not looked up (past the lookup cap) — say so, never "not established". Cite _meta.competition.coverage_line.',
        // set_aside_type is NULL on ~65% of rows (only PIIDs matched in the BQ awards
        // backfill carry it). NULL means UNKNOWN, never "Full & Open" — do not tell a
        // user a contract is open to them because the field is empty.
        'set_aside_type is only known for contracts matched in the awards backfill; NULL means unknown, NOT unrestricted.',
      ],
    };
  }
  return result;
}
