/**
 * MCP tool: search_grants — federal grant opportunities from Grants.gov.
 *
 * Broadens "what can I win" beyond contracts into $700B+ of federal grant
 * funding. Wraps src/lib/grants/search.ts (public Grants.gov API, commodity,
 * metered). credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { searchGrants, type GrantResult } from '@/lib/grants/search';
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
  _meta: { grounded: boolean; degraded: boolean; count: number; total: number };
}

export async function grantsSearch(input: GrantsToolInput): Promise<GrantsToolResult> {
  const status = input.status || 'posted';
  const res = await searchGrants({
    keyword: input.keyword,
    agency: input.agency,
    category: input.category,
    status,
    limit: input.limit,
  });
  const grounded = res.grants.length > 0;
  const result: GrantsToolResult = {
    queried: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.agency ? { agency: input.agency } : {}),
      status,
    },
    grants: res.grants,
    _meta: { grounded, degraded: res.degraded, count: res.grants.length, total: res.total },
  };
  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: res.degraded
        ? 'Grants.gov could not be reached — retry; do not state there are no grants.'
        : grounded
        ? `${res.grants.length} ${status} grant(s)${res.agencyFiltered ? ' (agency-filtered)' : ` of ~${res.total} matching`}. Top: ${res.grants[0].title} (${res.grants[0].agency}).`
        : `No ${status} grants matched. Broaden the keyword or drop the agency/category.`,
      how_to_use: grounded
        ? 'Cite closeDate for the deadline and awardCeiling for size. These are grants (assistance), not contracts — different application path than SAM.gov.'
        : 'No grounded grants; say none matched rather than inventing one.',
      key_caveats: [
        'Agency is a client-side prefix filter (a hit\'s agencyCode is like "DOD-AMRAA").',
        'awardCeiling can be null when Grants.gov omits it.',
      ],
    };
  }
  return result;
}
