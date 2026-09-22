/**
 * MCP tool: get_agency_spending_detail — "who inside this department buys, and can a
 * small business actually win here." Complements get_agency_intel (identity + top NAICS)
 * with the sub-agency (component) spending breakdown + the set-aside distribution.
 *
 * SYSCOM queries (NAVSEA) stay SYSCOMs: total_obligated is null; spending.scope is
 * PARENT_SERVICE with the military department's dollars. Navy $176.6B is not NAVSEA.
 *
 * small_business_share is SET-ASIDE-CODE share. recipient_small_business_share is
 * who won. Neither is the SBA 23% goaling figure.
 */
import { getAgencySpendingDetail, type SubAgencySlice, type SetAsideSlice } from '@/lib/usaspending/agency-spending-detail';
import { mcpFlags } from '@/lib/mcp/flags';
import type { CommandSpendingStatus, RequestedIdentity, SpendingScope } from '@/lib/gov-contacts/agency-identity';

export interface AgencySpendingDetailToolInput {
  /** Agency name or abbreviation, e.g. "Department of Defense", "VA", "NASA". */
  agency: string;
  /** Fiscal year (defaults to the latest complete FY). */
  fiscal_year?: number;
}

export interface AgencySpendingDetailToolResult {
  agency: string | null;
  toptier_code: string | null;
  fiscal_year: number;
  total_obligated: number | null;
  sub_agencies: SubAgencySlice[];
  set_aside_breakdown: SetAsideSlice[];
  small_business_share: number | null;
  set_aside_share: number | null;
  recipient_small_business_amount: number | null;
  recipient_small_business_share: number | null;
  requested_identity: RequestedIdentity;
  spending: { scope: SpendingScope; scope_name: string | null; total: number | null };
  command_spending: { status: CommandSpendingStatus };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    fiscal_year: number;
    sub_agency_count: number;
    small_business_share: number | null;
    spending_scope: SpendingScope;
  };
}

function usd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(0)}`;
}

export async function getAgencySpendingDetailTool(input: AgencySpendingDetailToolInput): Promise<AgencySpendingDetailToolResult> {
  const res = await getAgencySpendingDetail({ agency: input.agency, fiscalYear: input.fiscal_year });

  const requestedDollars = typeof res.total_obligated === 'number' && res.total_obligated > 0;
  const grounded = !res.degraded && res.agency !== null && (requestedDollars || res.spending.scope === 'PARENT_SERVICE');

  const result: AgencySpendingDetailToolResult = {
    agency: res.agency,
    toptier_code: res.toptier_code,
    fiscal_year: res.fiscal_year,
    total_obligated: res.total_obligated,
    sub_agencies: res.sub_agencies,
    set_aside_breakdown: res.set_aside_breakdown,
    small_business_share: res.small_business_share,
    set_aside_share: res.set_aside_share,
    recipient_small_business_amount: res.recipient_small_business_amount,
    recipient_small_business_share: res.recipient_small_business_share,
    requested_identity: res.requested_identity,
    spending: res.spending,
    command_spending: res.command_spending,
    _meta: {
      grounded,
      degraded: res.degraded,
      fiscal_year: res.fiscal_year,
      sub_agency_count: res.sub_agencies.length,
      small_business_share: res.small_business_share,
      spending_scope: res.spending.scope,
    },
  };

  if (mcpFlags.aiHint) {
    const topSub = res.sub_agencies[0];
    const topSetAside = [...res.set_aside_breakdown].filter((b) => b.label !== 'Small Business (total set-aside)').sort((a, b) => b.amount - a.amount)[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending errored on the total — treat as temporarily unavailable, not $0.'
        : res.spending.scope === 'PARENT_SERVICE'
        ? `${res.agency} identity is established. Command-level spending is NOT_ESTABLISHED. Parent-service (${res.spending.scope_name}) obligated ${typeof res.spending.total === 'number' ? usd(res.spending.total) : 'an unmeasured total'} — do not attribute that to ${res.agency}.`
        : !requestedDollars
        ? `No toptier agency matched "${input.agency}" (or spend is not established). Do NOT invent figures.`
        : `${res.agency} FY${res.fiscal_year}: ${usd(res.total_obligated!)} in contract obligations (toptier_code ${res.toptier_code} is the USASpending parent). Set-aside share ${res.set_aside_share}% · small-business recipients ${res.recipient_small_business_share}%. Neither is the SBA 23% goaling figure.${topSub ? ` Top component: ${topSub.name} (${topSub.pct_of_total}%).` : ''}${topSetAside && topSetAside.amount > 0 ? ` Biggest set-aside lane: ${topSetAside.label} (${usd(topSetAside.amount)}).` : ''}`,
      how_to_use:
        'Use spending.scope. REQUESTED dollars are this entity. PARENT_SERVICE dollars are the military department, not the SYSCOM. Set-aside share ≠ recipient small-business share ≠ 23% statutory goal.',
      key_caveats: [
        'Contract obligations only (award types A/B/C/D) for the fiscal year — NOT total agency budget.',
        'toptier_code 097 on a Navy row is DoD, the USASpending parent of the Navy subtier — not a claim these dollars are all of DoD.',
        'set_aside_share sums set-aside competition codes. recipient_small_business_share uses recipient_type_names=small_business. SBA goaling uses a third eligible-dollar base.',
      ],
    };
  }
  return result;
}
