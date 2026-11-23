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
import { getAgencySpendingDetail, setAsideIncompleteReason, VA_VOSB_BUCKET, type SubAgencySlice, type SetAsideSlice, type SubAgencyStructure } from '@/lib/usaspending/agency-spending-detail';
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
  /** null = the sub-agency lookup failed (unknown). See sub_agency_structure for an empty list. */
  sub_agencies: SubAgencySlice[] | null;
  sub_agency_structure: SubAgencyStructure;
  /** Plain-language note when the list is empty or unknown — never leave an empty table unexplained. */
  sub_agency_note?: string;
  set_aside_breakdown: SetAsideSlice[];
  /** VA only: what the distinct VOSB (VA only) set-aside row shows next to SDVOSB. Facts from the returned rows. */
  set_aside_note?: string;
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
    /** null when the sub-agency lookup failed (unknown). */
    sub_agency_count: number | null;
    small_business_share: number | null;
    spending_scope: SpendingScope;
    /** Set when a set-aside bucket lookup failed: result_state becomes 'partial' (the rest is real data). */
    incomplete_reason?: string;
  };
}

function usd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(0)}`;
}

/**
 * The sentence a reader needs when there is no sub-agency list. single_self_named is a fact about the source
 * (VA files every contract award under one sub-agency named "Department of Veterans Affairs"), so it is said
 * plainly — not shown as an empty table, and office rows are never passed off as sub-agencies.
 */
export function subAgencyNote(res: { agency: string | null; sub_agency_structure: SubAgencyStructure }): string | null {
  const a = res.agency || 'This agency';
  switch (res.sub_agency_structure) {
    case 'single_self_named':
      return `${a} records all of its contract awards under a single sub-agency (${a}) in USASpending, so there is no sub-agency breakdown; its spending splits by contracting office instead.`;
    case 'unavailable':
      return 'The sub-agency breakdown could not be retrieved from USASpending just now (unknown, not none).';
    case 'none':
      return 'USASpending returned no sub-agency rows for this agency and year.';
    default:
      return null;
  }
}

function fmtMoney(n: number): string {
  const a = Math.abs(n);
  const body = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a).toLocaleString('en-US')}`;
  return n < 0 ? `−${body}` : body;
}
function fmtPct(p: number): string {
  return p !== 0 && Math.abs(p) < 0.1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
}

/**
 * VA's VOSB set-aside codes (VSA/VSS) are their own row, never folded into SDVOSB. The note states only what the
 * rows show: the signed NET VOSB amount and share, and SDVOSB beside it. "Small share" and "mostly to SDVOSB" are
 * said only when the numbers make them true; nothing about VA policy is asserted beyond the codes.
 */
export function setAsideNote(res: { fiscal_year: number; set_aside_breakdown: SetAsideSlice[] }): string | null {
  const vosb = res.set_aside_breakdown.find((b) => b.label === VA_VOSB_BUCKET.label);
  if (!vosb) return null;
  if (vosb.amount === null || vosb.pct_of_total === null) {
    return 'The VOSB (VA only) set-aside amount could not be retrieved from USASpending just now (unknown, not $0).';
  }
  const vosbFact = `${fmtMoney(vosb.amount)} net, ${fmtPct(vosb.pct_of_total)} in FY${res.fiscal_year}`;
  const sd = res.set_aside_breakdown.find((b) => b.label === 'SDVOSB');
  const sdFact = sd && sd.amount !== null && sd.pct_of_total !== null ? `${fmtMoney(sd.amount)}, ${fmtPct(sd.pct_of_total)}` : null;
  if (sdFact && Math.abs(vosb.pct_of_total) < 1 && sd!.amount! > vosb.amount) {
    return `VOSB set-asides are a small share of VA contract dollars (${vosbFact}); VA's veteran set-aside dollars go mostly to SDVOSB (${sdFact}).`;
  }
  return `VOSB (VA only) set-asides: ${vosbFact}.${sdFact ? ` SDVOSB: ${sdFact}.` : ''}`;
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
    sub_agency_structure: res.sub_agency_structure,
    ...(subAgencyNote(res) ? { sub_agency_note: subAgencyNote(res)! } : {}),
    set_aside_breakdown: res.set_aside_breakdown,
    ...(setAsideNote(res) ? { set_aside_note: setAsideNote(res)! } : {}),
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
      // null when the lookup failed (unknown), never 0.
      sub_agency_count: res.sub_agencies ? res.sub_agencies.length : null,
      small_business_share: res.small_business_share,
      spending_scope: res.spending.scope,
      ...(setAsideIncompleteReason(res.set_aside_breakdown) ? { incomplete_reason: setAsideIncompleteReason(res.set_aside_breakdown)! } : {}),
    },
  };

  if (mcpFlags.aiHint) {
    const topSub = res.sub_agencies?.[0];
    // Every bucket is a disjoint set of codes (none is a rollup), so all compete for "biggest lane".
    const topSetAside = [...res.set_aside_breakdown].sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity))[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending errored on the total — treat as temporarily unavailable, not $0.'
        : res.spending.scope === 'PARENT_SERVICE'
        ? `${res.agency} identity is established. Command-level spending is NOT_ESTABLISHED. Parent-service (${res.spending.scope_name}) obligated ${typeof res.spending.total === 'number' ? usd(res.spending.total) : 'an unmeasured total'} — do not attribute that to ${res.agency}.`
        : !requestedDollars
        ? `No toptier agency matched "${input.agency}" (or spend is not established). Do NOT invent figures.`
        : `${res.agency} FY${res.fiscal_year}: ${usd(res.total_obligated!)} in contract obligations (toptier_code ${res.toptier_code} is the USASpending parent). Set-aside share ${res.set_aside_share}% · small-business recipients ${res.recipient_small_business_share}%. Neither is the SBA 23% goaling figure.${topSub ? ` Top component: ${topSub.name} (${topSub.pct_of_total}%).` : ''}${topSetAside && (topSetAside.amount ?? 0) > 0 ? ` Biggest set-aside lane: ${topSetAside.label} (${usd(topSetAside.amount as number)}).` : ''}`,
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
