/**
 * MCP tool: search_idv_contracts — Indefinite-Delivery Vehicles (IDIQ/GWAC/BPA) and
 * their task orders. The "how do I get ON the vehicle, and what's flowing THROUGH it"
 * view. Filter by NAICS / PSC / agency / state / value; toggle base IDVs vs task orders.
 *
 * Wraps src/lib/idv-search.ts (USASpending live search, free upstream, commodity,
 * metered). credits: 2 (live USASpending search). `_meta` always ships; `_ai_hint`
 * OFF by default.
 */
import { searchIDVContracts, type IDVContract } from '@/lib/idv-search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface IdvContractsToolInput {
  naics?: string;
  psc?: string;
  agency?: string;
  state?: string;
  min_value?: number;
  date_from?: string;
  date_to?: string;
  /** 'idv' = base vehicles (IDIQ/GWAC/BPA); 'task' = task/delivery orders under them. */
  search_type?: 'idv' | 'task';
  limit?: number;
  page?: number;
}

export interface IdvContractsToolResult {
  queried: Record<string, string | number>;
  search_type: 'idv_contracts' | 'task_orders';
  contracts: IDVContract[];
  has_next_page: boolean;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number; total: number };
}

export async function idvContracts(input: IdvContractsToolInput): Promise<IdvContractsToolResult> {
  let res;
  let degraded = false;
  try {
    res = await searchIDVContracts({
      naicsCode: input.naics,
      pscCode: input.psc,
      agency: input.agency,
      state: input.state,
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
