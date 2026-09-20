/**
 * MCP tool: get_agency_spending_detail — "who inside this department buys, and can a
 * small business actually win here." Complements get_agency_intel (identity + top NAICS)
 * with the sub-agency (component) spending breakdown + the set-aside distribution (Small
 * Business / 8(a) / SDVOSB / WOSB / HUBZone shares) — the small-business "easy entry"
 * read. All figures are live USASpending contract obligations for a fiscal year.
 *
 * Command identity (NAVSEA, NAVAIR, USCG) is not collapsed into parent dollars.
 * Parent-service totals are labeled PARENT_SERVICE; command_spending stays
 * NOT_ESTABLISHED. Do not treat spending.total as the command's own obligated total.
 *
 * Wraps the pure src/lib/usaspending/agency-spending-detail.ts (USASpending only, no LLM).
 * grounded=false = identity and dollars both unestablished (do NOT invent figures);
 * degraded=true = the USASpending total call errored (temporarily unavailable, not $0).
 * `_meta` always ships; `_ai_hint` OFF.
 */
import {
  getAgencySpendingDetail,
  type AgencySpendingDetailResult,
  type NestedSpending,
  type SubAgencySlice,
  type SetAsideSlice,
} from '@/lib/usaspending/agency-spending-detail';
import type { CommandSpendingStatus, RequestedIdentity } from '@/lib/gov-contacts/agency-identity';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AgencySpendingDetailToolInput {
  /** Agency name or abbreviation, e.g. "Department of Defense", "VA", "NAVSEA". */
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
  requested_identity: RequestedIdentity;
  spending: NestedSpending;
  command_spending: { status: CommandSpendingStatus };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    fiscal_year: number;
    sub_agency_count: number;
    small_business_share: number | null;
    spending_scope: NestedSpending['scope'];
  };
}

function usd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(0)}`;
}

export function spendingDetailGrounded(res: AgencySpendingDetailResult): boolean {
  if (res.degraded) return false;
  if (res.spending.scope === 'PARENT_SERVICE') {
    return !!res.requested_identity.command
      && typeof res.spending.total === 'number'
      && res.spending.total > 0;
  }
  if (res.spending.scope === 'REQUESTED') {
    return res.agency !== null && typeof res.total_obligated === 'number' && res.total_obligated > 0;
  }
  return res.agency !== null && res.command_spending.status === 'NOT_ESTABLISHED';
}

export async function getAgencySpendingDetailTool(input: AgencySpendingDetailToolInput): Promise<AgencySpendingDetailToolResult> {
  const res = await getAgencySpendingDetail({ agency: input.agency, fiscalYear: input.fiscal_year });

  const grounded = spendingDetailGrounded(res);

  const result: AgencySpendingDetailToolResult = {
    agency: res.agency,
    toptier_code: res.toptier_code,
    fiscal_year: res.fiscal_year,
    total_obligated: res.total_obligated,
    sub_agencies: res.sub_agencies,
    set_aside_breakdown: res.set_aside_breakdown,
    small_business_share: res.small_business_share,
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
    const parentTotal = res.spending.total;
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending errored on the total — treat as temporarily unavailable, not $0.'
        : res.spending.scope === 'PARENT_SERVICE' && grounded
        ? `${res.agency} identity is established. Command-level spending is NOT_ESTABLISHED. Parent-service (${res.spending.scope_name}) contract obligations: ${typeof parentTotal === 'number' ? usd(parentTotal) : 'unknown'}. Do NOT attribute that total to ${res.agency}.`
        : res.command_spending.status === 'NOT_ESTABLISHED' && res.agency
        ? `${res.agency} identity is established. Command-level spending is NOT_ESTABLISHED — do NOT invent a total or borrow the parent department's dollars.`
        : !grounded
        ? `No agency identity matched "${input.agency}". Try the full department name (e.g. "Department of Defense") — do NOT invent figures.`
        : `${res.agency} FY${res.fiscal_year}: ${usd(res.total_obligated || 0)} in contract obligations, ${res.small_business_share}% via small-business set-asides.${topSub ? ` Top component: ${topSub.name} (${topSub.pct_of_total}%).` : ''}${topSetAside && topSetAside.amount > 0 ? ` Biggest set-aside lane: ${topSetAside.label} (${usd(topSetAside.amount)}).` : ''}`,
      how_to_use:
        'requested_identity is who was asked. spending.scope tells whose dollars spending.total is. PARENT_SERVICE dollars are the military department, never the command. Command spend is NOT_ESTABLISHED until a command-level source exists. Pair REQUESTED department totals with search_federal_contacts / search_agency_opps_by_office for the component.',
      key_caveats: [
        'Contract obligations only (award types A/B/C/D) for the fiscal year — NOT total agency budget (which includes grants, mandatory spending, payroll).',
        'Set-aside buckets are mutually exclusive by code; small_business_share is their sum ÷ total. An agency with a large sub-agency list (DoD) is a department — target the component, not "DoD".',
        'Never copy spending.total onto a command as total_obligated. NAVSEA is NAVSEA; Navy dollars are PARENT_SERVICE.',
      ],
    };
  }
  return result;
}
