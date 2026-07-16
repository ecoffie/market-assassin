/**
 * MCP tool: search_past_contracts — awarded federal PRIME contracts by LOCATION
 * (place of performance / recipient HQ / both) + NAICS / PSC / agency / recipient
 * / value / date. The "what contracts were awarded in <state>" lookup.
 *
 * Wraps src/lib/usaspending/awards-search.ts (USASpending spending_by_award,
 * live, authoritative). Distinct from search_idv_contracts (vehicles + task
 * orders) and get_contractor_award_history (a single named firm). credits: 2
 * (live USASpending search). `_meta` always ships; `_ai_hint` OFF by default.
 */
import { searchAwardsByLocation, type AwardRow, type StateScope } from '@/lib/usaspending/awards-search';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';

export interface PastContractsToolInput {
  state?: string;
  /** 'pop' (place of performance, default) | 'recipient' (HQ) | 'both' (union). */
  state_scope?: StateScope;
  naics?: string;
  psc?: string;
  agency?: string;
  recipient?: string;
  min_value?: number;
  date_from?: string;
  date_to?: string;
  include_idv?: boolean;
  limit?: number;
}

export interface PastContractsToolResult {
  queried: Record<string, string | number | boolean>;
  awards: AwardRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    total: number;
    state_scope: StateScope;
    requests_fired: number;
  };
}

export async function searchPastContracts(input: PastContractsToolInput): Promise<PastContractsToolResult> {
  const scope: StateScope = input.state_scope ?? 'pop';
  // Accept "Florida" or "FL"; drop an unrecognized value rather than filter on junk.
  const state = input.state ? normalizeStateCode(input.state) ?? undefined : undefined;

  const res = await searchAwardsByLocation({
    state,
    stateScope: scope,
    naics: input.naics,
    psc: input.psc,
    agency: input.agency,
    recipient: input.recipient,
    minValue: input.min_value,
    dateFrom: input.date_from,
    dateTo: input.date_to,
    includeIdv: input.include_idv,
    limit: input.limit,
  });

  const grounded = res.awards.length > 0;
  const queried: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries({
    state,
    state_scope: scope,
    naics: input.naics,
    psc: input.psc,
    agency: input.agency,
    recipient: input.recipient,
    include_idv: input.include_idv,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number | boolean;
  }

  const result: PastContractsToolResult = {
    queried,
    awards: res.awards,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.count,
      total: res.totalEstimate,
      state_scope: scope,
      requests_fired: res.requestsFired,
    },
  };

  if (mcpFlags.aiHint) {
    const top = res.awards[0];
    const where =
      scope === 'both' ? 'performed in OR awarded to a firm in' : scope === 'recipient' ? 'awarded to a firm HQ’d in' : 'performed in';
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending award search errored — retry; do not state there are no awards.'
        : grounded
        ? `${res.count} of ~${res.totalEstimate} awards ${where} ${state ?? 'the filtered scope'}. Top: ${top.recipientName} — $${Math.round(top.awardAmount).toLocaleString()} (${top.agency}).`
        : `No awards matched. Broaden the NAICS/PSC, widen the date range, or try state_scope:"both".`,
      how_to_use: grounded
        ? 'Historical prime awards (already awarded, not open bids). recipientName = who won; popState = where the work is done; use get_award_detail on generatedId for the full record, or get_contractor_award_history on a recipient to size them up.'
        : 'No grounded results; say none matched rather than inventing an award.',
      key_caveats: [
        'Place-of-performance state is well-populated on awards, but a firm can perform in a state it is not HQ’d in — state_scope controls which side you match.',
        'These are AWARDED contracts (past), not open solicitations. For open opportunities use search_sam_opportunities.',
        'awardAmount is the award’s current amount; multi-year ceilings live in get_award_detail.',
      ],
    };
  }
  return result;
}
