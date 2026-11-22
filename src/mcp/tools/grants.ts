/**
 * MCP tool: search_grants — federal grant opportunities from Grants.gov.
 *
 * Broadens "what can I win" beyond contracts into $700B+ of federal grant
 * funding. Wraps src/lib/grants/search.ts (public Grants.gov API, commodity,
 * metered). credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { rankGrantsByRelevance, searchGrants, type GrantResult, type GrantSearchResult } from '@/lib/grants/search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface GrantsToolInput {
  keyword?: string;
  agency?: string;
  category?: string;
  status?: 'posted' | 'forecasted' | 'closed' | 'archived';
  limit?: number;
}

export interface GrantsToolResult {
  queried: { keyword?: string; agency?: string; status: string };
  grants: GrantResult[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean; degraded: boolean; count: number; total: number;
    /** Grants.gov statuses this call searched. No status asked → posted AND forecasted (spec: include forecasted programs). */
    statuses_searched: Array<'posted' | 'forecasted' | 'closed' | 'archived'>;
    /** Forecasted rows returned: plans, not open opportunities. */
    forecasted_count: number;
  };
}

export async function grantsSearch(input: GrantsToolInput): Promise<GrantsToolResult> {
  const statuses: GrantsToolResult['_meta']['statuses_searched'] = input.status ? [input.status] : ['posted', 'forecasted'];
  const status = statuses.join('+');
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  // Two calls with values Grants.gov is known to accept, merged here: an unsupported filter value on
  // this endpoint returns a SILENT empty (see search.ts), so a combined status filter is not guessed.
  const runs: GrantSearchResult[] = await Promise.all(statuses.map((s) => searchGrants({
    keyword: input.keyword, agency: input.agency, category: input.category, status: s, limit,
  })));
  const merged = statuses.length > 1
    ? rankGrantsByRelevance(runs.flatMap((r) => r.grants), input.keyword || '').slice(0, limit)
    : runs[0].grants;
  const res = {
    grants: merged,
    degraded: runs.some((r) => r.degraded),
    total: runs.reduce((n, r) => n + r.total, 0),
    agencyFiltered: runs.some((r) => r.agencyFiltered),
  };
  const grounded = res.grants.length > 0;
  const forecastedCount = res.grants.filter((g) => (g.status || '').toLowerCase() === 'forecasted').length;
  const result: GrantsToolResult = {
    queried: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.agency ? { agency: input.agency } : {}),
      status,
    },
    grants: res.grants,
    _meta: { grounded, degraded: res.degraded, count: res.grants.length, total: res.total, statuses_searched: statuses, forecasted_count: forecastedCount },
  };
  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: res.degraded
        ? 'Grants.gov could not be reached — retry; do not state there are no grants.'
        : grounded
        ? `${res.grants.length} ${status} grant(s)${res.agencyFiltered ? ' (agency-filtered)' : ` of ~${res.total} matching`}. Top: ${res.grants[0].title} (${res.grants[0].agency}).`
        : `No ${status} grants matched. Broaden the keyword or drop the agency/category.`,
      how_to_use: grounded
        ? 'Grants are ranked by what the keyword names (match: title first, then assistance listing, then synopsis only). A grant with status forecasted is a PLAN, not an open opportunity: say so. Cite closeDate for the deadline and awardCeiling for size. These are grants (assistance), not contracts — different application path than SAM.gov.'
        : 'No grounded grants; say none matched rather than inventing one.',
      key_caveats: [
        'Agency is a client-side prefix filter (a hit\'s agencyCode is like "DOD-AMRAA").',
        'awardCeiling can be null when Grants.gov omits it.',
      ],
    };
  }
  return result;
}
