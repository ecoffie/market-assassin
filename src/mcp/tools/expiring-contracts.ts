/**
 * MCP tool: get_expiring_contracts — federal contracts expiring soon (recompete
 * targets). "Who's about to lose their contract, so I can pursue the recompete."
 *
 * Wraps src/lib/recompete/query.ts (Supabase `recompete_opportunities`,
 * USASpending-derived, commodity, metered). credits: 5. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ExpiringContractsToolInput {
  naics?: string;
  agency?: string;
  state?: string;
  months_window?: number;
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
  contracts: ExpiringContract[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number; total: number };
}

export async function expiringContracts(input: ExpiringContractsToolInput): Promise<ExpiringContractsToolResult> {
  const res = await queryExpiringContracts({
    naics: input.naics,
    agency: input.agency,
    state: input.state,
    monthsWindow: input.months_window,
    minValue: input.min_value,
    maxValue: input.max_value,
    likelihood: input.likelihood,
    eligibleSetAsides: input.eligible_set_asides,
    limit: input.limit,
  });
  const grounded = res.contracts.length > 0;
  const queried: Record<string, string | number> = {};
  for (const [k, v] of Object.entries({ naics: input.naics, agency: input.agency, state: input.state, months_window: input.months_window, likelihood: input.likelihood })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }
  const result: ExpiringContractsToolResult = {
    queried,
    contracts: res.contracts,
    _meta: { grounded, degraded: res.degraded, count: res.contracts.length, total: res.total },
  };
  if (mcpFlags.aiHint) {
    const top = res.contracts[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Recompete lookup errored — retry; do not state there are no expiring contracts.'
        : grounded
        ? `${res.contracts.length} of ~${res.total} contracts expiring in-window, soonest first. Top: ${top.incumbent_name ?? 'incumbent n/a'} @ ${top.awarding_agency ?? 'agency n/a'} ends ${top.period_of_performance_current_end ?? '?'}.`
        : 'No expiring contracts matched. Widen months_window or drop filters.',
      how_to_use: grounded
        ? 'incumbent_name = who to unseat; period_of_performance_current_end = the clock; potential_total_value = the prize ceiling. Agencies plan recompetes 12-18mo out, so target contracts ending in your capture window. '
          + 'set_aside_type is the ELIGIBILITY GATE and the first thing to surface for a small business: "SB-Total"/"8(a)"/"SDVOSB"/"WOSB"/"HUBZone" mean the large primes are legally barred from bidding, while "Full & Open" means they are not. '
          + 'A small firm asking "what can I win" wants the set-aside rows, not the biggest dollar rows — a $90M Full & Open recompete held by a top-10 prime is not a target, and listing it as one reads as noise.'
        : 'No grounded contracts; say none matched rather than inventing one.',
      key_caveats: [
        'A multiple-award IDIQ appears as several rows (one per holder) — not deduped to one vehicle here.',
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
