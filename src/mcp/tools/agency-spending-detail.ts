/**
 * MCP tool: get_agency_spending_detail — "who inside this department buys, and can a
 * small business actually win here." Complements get_agency_intel (identity + top NAICS)
 * with the sub-agency (component) spending breakdown + the set-aside distribution (Small
 * Business / 8(a) / SDVOSB / WOSB / HUBZone shares) — the small-business "easy entry"
 * read. All figures are live USASpending contract obligations for a fiscal year.
 *
 * Wraps the pure src/lib/usaspending/agency-spending-detail.ts (USASpending only, no LLM).
 * grounded=false = no toptier agency matched (do NOT invent figures); degraded=true = the
 * USASpending total call errored (temporarily unavailable, not $0). tier: metered,
 * credits: 2 (multiple USASpending aggregates). `_meta` always ships; `_ai_hint` OFF.
 */
import { getAgencySpendingDetail, type SubAgencySlice, type SetAsideSlice } from '@/lib/usaspending/agency-spending-detail';
import { mcpFlags } from '@/lib/mcp/flags';

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
  total_obligated: number;
  sub_agencies: SubAgencySlice[];
  set_aside_breakdown: SetAsideSlice[];
  small_business_share: number;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    fiscal_year: number;
    sub_agency_count: number;
    small_business_share: number;
  };
}

function usd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(0)}`;
}

export async function getAgencySpendingDetailTool(input: AgencySpendingDetailToolInput): Promise<AgencySpendingDetailToolResult> {
  const res = await getAgencySpendingDetail({ agency: input.agency, fiscalYear: input.fiscal_year });

  const grounded = !res.degraded && res.agency !== null && res.total_obligated > 0;

  const result: AgencySpendingDetailToolResult = {
    agency: res.agency,
    toptier_code: res.toptier_code,
    fiscal_year: res.fiscal_year,
    total_obligated: res.total_obligated,
    sub_agencies: res.sub_agencies,
    set_aside_breakdown: res.set_aside_breakdown,
    small_business_share: res.small_business_share,
    _meta: {
      grounded,
      degraded: res.degraded,
      fiscal_year: res.fiscal_year,
      sub_agency_count: res.sub_agencies.length,
      small_business_share: res.small_business_share,
    },
  };

  if (mcpFlags.aiHint) {
    const topSub = res.sub_agencies[0];
    const topSetAside = [...res.set_aside_breakdown].filter((b) => b.label !== 'Small Business (total set-aside)').sort((a, b) => b.amount - a.amount)[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending errored on the total — treat as temporarily unavailable, not $0.'
        : !grounded
        ? `No toptier agency matched "${input.agency}". Try the full department name (e.g. "Department of Defense") — do NOT invent figures.`
        : `${res.agency} FY${res.fiscal_year}: ${usd(res.total_obligated)} in contract obligations, ${res.small_business_share}% via small-business set-asides.${topSub ? ` Top component: ${topSub.name} (${topSub.pct_of_total}%).` : ''}${topSetAside && topSetAside.amount > 0 ? ` Biggest set-aside lane: ${topSetAside.label} (${usd(topSetAside.amount)}).` : ''}`,
      how_to_use:
        'The set-aside breakdown is the "can a small business win here" read — a high 8(a)/SDVOSB/WOSB share means real small-business lanes. The sub-agency breakdown says which COMPONENT to target (pair with search_federal_contacts / search_agency_opps_by_office for that component). Pair with get_agency_intel for top NAICS + pain points.',
      key_caveats: [
        'Contract obligations only (award types A/B/C/D) for the fiscal year — NOT total agency budget (which includes grants, mandatory spending, payroll).',
        'Set-aside buckets are mutually exclusive by code; small_business_share is their sum ÷ total. An agency with a large sub-agency list (DoD) is a department — target the component, not "DoD".',
      ],
    };
  }
  return result;
}
