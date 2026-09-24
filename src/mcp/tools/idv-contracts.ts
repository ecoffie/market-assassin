/**
 * MCP tool: search_idv_contracts — Indefinite-Delivery Vehicles (IDIQ/GWAC/BPA) and
 * their task orders. The "how do I get ON the vehicle, and what's flowing THROUGH it"
 * view. Filter by NAICS / PSC / agency / state / value; toggle base IDVs vs task orders.
 *
 * Wraps src/lib/idv-search.ts (USASpending live search, free upstream, commodity,
 * metered). credits: 5 (live USASpending search). `_meta` always ships; `_ai_hint`
 * OFF by default.
 */
import { searchIDVContracts, type IDVContract } from '@/lib/idv-search';
import { mcpFlags } from '@/lib/mcp/flags';
import { searchScopedTaskOrders, type ScopedTaskOrderResult, type ScopedTaskOrderRow } from '@/lib/vehicles/task-order-search';

export interface IdvContractsToolInput {
  naics?: string;
  psc?: string;
  agency?: string;
  state?: string;
  /** Which location the `state` filter targets: 'recipient' HQ (default), 'pop' place of performance, or 'both' (union). */
  state_scope?: 'recipient' | 'pop' | 'both';
  min_value?: number;
  date_from?: string;
  date_to?: string;
  /** 'idv' = base vehicles (IDIQ/GWAC/BPA); 'task' = task/delivery orders under them. */
  search_type?: 'idv' | 'task';
  limit?: number;
  page?: number;
  /**
   * Restrict TASK ORDERS to a contract vehicle by name (e.g. "OASIS+"). Resolved only through the
   * verified vehicle registry — an unknown/ambiguous name returns status "unresolved", never all vehicles.
   */
  vehicle?: string;
  /** Restrict TASK ORDERS to exact parent contract id(s): CONT_IDV_<PIID>_<AGENCY> (comma list). */
  parent_id?: string;
  /** Work subject within a vehicle/parent scope — every word must appear in the order's work text. */
  work?: string;
  /** Scoped search window: orders ending within N months (1–60, default 60). */
  lead_months?: number;
}

type ScopedContract = IDVContract & Pick<ScopedTaskOrderRow, 'parent' | 'work_evidence' | 'on_map'> & { contractId: string };

export interface IdvContractsToolResult {
  queried: Record<string, string | number>;
  search_type: 'idv_contracts' | 'task_orders';
  contracts: IDVContract[] | ScopedContract[];
  has_next_page: boolean;
  /** Vehicle/parent-scoped searches only. */
  status?: ScopedTaskOrderResult['status'];
  reason?: string | null;
  scope?: ScopedTaskOrderResult['scope'];
  population?: string;
  coverage?: {
    parent_orders_in_population: number | null;
    unattributed_orders: number | null;
    note: string;
  };
  map?: { url: string | null; mapped_total: number | null; unmapped_total: number | null; note: string };
  /** Scoped searches: every filter applied and the field it ran on. */
  applied_filters?: ScopedTaskOrderResult['applied_filters'];
  /** Scoped searches: filters that cannot run on this data — the search was NOT run. */
  refused_filters?: { filter: string; reason: string }[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number; total: number | null };
}

function toScopedContract(r: ScopedTaskOrderRow): ScopedContract {
  return {
    awardId: r.piid ?? '',
    contractId: r.contract_id,
    recipientName: r.recipient_name ?? '',
    recipientUei: r.recipient_uei ?? '',
    awardAmount: r.potential_total_value ?? 0,
    description: r.description ?? '',
    startDate: '',
    endDate: r.period_end ?? '',
    agency: r.agency ?? '',
    subAgency: r.sub_agency ?? '',
    naicsCode: r.naics_code ?? '',
    naicsDescription: r.naics_description ?? '',
    pscCode: '',
    pscDescription: r.psc_description ?? '',
    recipientState: '',
    popState: r.place_of_performance_state ?? '',
    generatedId: r.contract_id,
    usaSpendingUrl: r.usaspending_url,
    parent: r.parent,
    work_evidence: r.work_evidence,
    on_map: r.on_map,
  };
}

/**
 * Every tool input that the vehicle/parent-scoped search cannot honour on its data. A filter it cannot
 * run is REFUSED (status needs_refinement, nothing searched) — never dropped: a dropped filter returns a
 * broader market that reads as the narrower one the caller asked for.
 */
export function refusedScopedFilters(input: IdvContractsToolInput): { filter: string; reason: string }[] {
  const out: { filter: string; reason: string }[] = [];
  if (input.search_type === 'idv') out.push({ filter: 'search_type', reason: 'vehicle / parent_id scope TASK ORDERS; search_type:"idv" lists base vehicles. Omit search_type or pass "task".' });
  if (input.psc?.trim()) out.push({ filter: 'psc', reason: 'PSC cannot filter scoped orders: psc_code is populated on ~6% of this data and the Map\'s Awarded layer does not apply it. Use naics or a work subject.' });
  if (input.date_from?.trim() || input.date_to?.trim()) out.push({ filter: input.date_from?.trim() ? 'date_from' : 'date_to', reason: 'Scoped orders carry no action date; the window is the period-of-performance end (lead_months).' });
  if (input.state?.trim() && input.state_scope !== 'pop') out.push({ filter: 'state', reason: 'In a scoped search state means PLACE OF PERFORMANCE only (recipient HQ state is not on this data). Pass state_scope:"pop".' });
  return out;
}

async function scopedIdvContracts(input: IdvContractsToolInput): Promise<IdvContractsToolResult> {
  const queried: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({
    vehicle: input.vehicle, parent_id: input.parent_id, work: input.work, naics: input.naics, agency: input.agency,
    state: input.state, state_scope: input.state_scope, min_value: input.min_value, psc: input.psc,
    date_from: input.date_from, date_to: input.date_to, search_type: input.search_type, lead_months: input.lead_months,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }
  const refused = refusedScopedFilters(input);
  if (refused.length) {
    return {
      queried, search_type: 'task_orders', contracts: [], has_next_page: false, status: 'needs_refinement',
      reason: `Not searched — ${refused.map((r) => `${r.filter}: ${r.reason}`).join(' ')}`,
      refused_filters: refused,
      _meta: { grounded: false, degraded: false, count: 0, total: null },
    };
  }
  let r: ScopedTaskOrderResult | null = null;
  try {
    r = await searchScopedTaskOrders({
      vehicle: input.vehicle, parent_id: input.parent_id, work: input.work, naics: input.naics,
      agency: input.agency, state: input.state, min_value: input.min_value, lead_months: input.lead_months, limit: input.limit, page: input.page,
    });
  } catch (err) {
    console.error('[mcp:idv-contracts] scoped search failed:', err);
  }
  if (!r) {
    return {
      queried, search_type: 'task_orders', contracts: [], has_next_page: false, status: 'degraded',
      reason: 'The scoped task-order search errored — retry; do not report zero orders.',
      _meta: { grounded: false, degraded: true, count: 0, total: null },
    };
  }
  const contracts = r.orders.map(toScopedContract);
  const result: IdvContractsToolResult = {
    queried,
    search_type: 'task_orders',
    contracts,
    has_next_page: r.has_next_page,
    status: r.status,
    reason: r.reason,
    scope: r.scope,
    population: r.population,
    applied_filters: r.applied_filters,
    coverage: {
      parent_orders_in_population: r.parent_orders_in_population,
      unattributed_orders: r.unattributed_orders,
      note: 'parent_orders_in_population = the vehicle/parent\'s orders in this population before work/NAICS/agency/state filters. '
        + 'unattributed_orders = orders matching the same work/filters whose parent contract is NOT recorded — they cannot be attributed to any vehicle, so they are neither included nor ruled out.',
    },
    map: {
      url: r.map_url, mapped_total: r.mapped_total, unmapped_total: r.unmapped_total,
      note: 'The Map link opens the Awarded layer with the same scope. The Map headline counts mapped orders (mapped_total); orders without a location (unmapped_total) are listed as not drawable. mapped_total + unmapped_total = total.',
    },
    _meta: { grounded: contracts.length > 0, degraded: r.status === 'degraded', count: contracts.length, total: r.total },
  };
  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: r.status === 'ok'
        ? `${r.total} active order(s) under ${r.scope && 'label' in r.scope ? r.scope.label : 'the requested parent'}; page ${r.page}.`
        : `${r.status}: ${r.reason ?? ''}`,
      how_to_use: 'Each order carries parent.parent_id (read from the award id) and, for vehicles, the verified solicitation it was awarded under. '
        + 'Membership of a vehicle is NOT eligibility: never state that a company holds or can use a vehicle from this result.',
      key_caveats: [
        'Population is active orders ending within the window, not all historical orders.',
        'status "unresolved" / "no_parent_orders" / "zero_matching_orders" are different facts — never report them as the same zero.',
      ],
    };
  }
  return result;
}

export async function idvContracts(input: IdvContractsToolInput): Promise<IdvContractsToolResult> {
  // Vehicle / exact-parent scope → the shared scoped search (the same query the Map's Awarded layer
  // runs). Without a scope the original USASpending path below runs unchanged.
  if (input.vehicle?.trim() || input.parent_id?.trim()) return scopedIdvContracts(input);
  if (input.work?.trim()) {
    return {
      queried: { work: input.work }, search_type: 'task_orders', contracts: [], has_next_page: false,
      status: 'needs_refinement',
      reason: '"work" narrows a vehicle- or parent-scoped task-order search. Pass vehicle (e.g. "OASIS+") or parent_id, or use naics/psc for an unscoped search.',
      _meta: { grounded: false, degraded: false, count: 0, total: null },
    };
  }
  let res;
  let degraded = false;
  try {
    res = await searchIDVContracts({
      naicsCode: input.naics,
      pscCode: input.psc,
      agency: input.agency,
      state: input.state,
      stateFilterType: input.state_scope,
      minValue: input.min_value,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      searchType: input.search_type,
      limit: input.limit,
      page: input.page,
    });
  } catch (err) {
    console.error('[mcp:idv-contracts] failed:', err);
    degraded = true;
  }

  const contracts = res?.contracts ?? [];
  const grounded = contracts.length > 0;
  const queried: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({
    naics: input.naics,
    psc: input.psc,
    agency: input.agency,
    state: input.state,
    search_type: input.search_type,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }

  const result: IdvContractsToolResult = {
    queried,
    search_type: res?.searchType ?? (input.search_type === 'task' ? 'task_orders' : 'idv_contracts'),
    contracts,
    has_next_page: res?.hasNextPage ?? false,
    _meta: { grounded, degraded, count: contracts.length, total: res?.totalCount ?? contracts.length },
  };

  if (mcpFlags.aiHint) {
    const top = contracts[0];
    const isTask = result.search_type === 'task_orders';
    result._ai_hint = {
      summary: degraded
        ? 'IDV search errored — retry; do not state there are no vehicles.'
        : grounded
        ? `${contracts.length} ${isTask ? 'task order(s)' : 'IDV(s)'} of ~${res!.totalCount} matching. Top: ${top.recipientName} — ${top.description?.slice(0, 80) ?? 'n/a'} (${top.agency}).`
        : `No ${isTask ? 'task orders' : 'IDVs'} matched. Broaden the NAICS/PSC or drop the agency filter.`,
      how_to_use: grounded
        ? isTask
          ? 'Task orders show demand FLOWING THROUGH a vehicle — recurring buyers + typical order size. To compete you generally need to already hold the parent IDV.'
          : 'Base IDVs are the vehicles you must be ON to win the task orders. recipientName = current holders; toggle search_type:"task" to see what is being ordered through them.'
        : 'No grounded results; say none matched rather than inventing a vehicle.',
      key_caveats: [
        'USASpending forbids mixing contract + IDV award-type groups — this tool queries one group per call (idv vs task).',
        'awardAmount on an IDV is the ceiling, not obligated spend; actual spend is in the task orders.',
      ],
    };
  }
  return result;
}
