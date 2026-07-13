/**
 * MCP tool: search_contractors — the competitive landscape for a market.
 *
 * "Who else plays here, and how big are they?" Given a keyword, NAICS, and/or
 * state, return the top federal contractors ranked by total obligated dollars,
 * with award count and how many distinct agencies each sells to (a capture
 * signal: broad seller vs. single-buyer dependent). This is the BD "size up the
 * competition / find teaming partners" lookup.
 *
 * Reuses src/lib/bigquery/recipients.ts:searchRecipients — the SAME query the
 * in-app Contractors panel uses. MUST pass liveBq:true, else queryCached defaults
 * to cacheOnly and returns [] on a cold cache (the documented 317K-rows-but-0-
 * results bug). Public USASpending-derived data (commodity, metered). credits: 2
 * (a live BigQuery scan). `_meta` always ships; `_ai_hint` OFF by default.
 */
import { searchRecipients, type RecipientSearchRow } from '@/lib/bigquery/recipients';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SearchContractorsInput {
  /** Free-text company-name match, e.g. "Booz" or "cyber". */
  keyword?: string;
  /** NAICS code(s), comma/space separated; 2-6 digit prefixes allowed, e.g. "541512" or "236,237". */
  naics?: string;
  /** Optional 2-letter state filter, e.g. "VA". */
  state?: string;
  /** Ranking: total_obligated (default), award_count, or recipient_name. */
  sort_by?: 'total_obligated' | 'award_count' | 'recipient_name';
  /** Max rows (default 15, max 100). */
  limit?: number;
}

export interface SearchContractorsResult {
  queried: { keyword?: string; naics?: string; state?: string; sort_by: string };
  contractors: RecipientSearchRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number };
}

export async function searchContractors(input: SearchContractorsInput): Promise<SearchContractorsResult> {
  const keyword = String(input.keyword ?? '').trim();
  const naics = String(input.naics ?? '').trim();
  const state = String(input.state ?? '').trim().toUpperCase();
  const sortBy = input.sort_by ?? 'total_obligated';
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 100);

  let contractors: RecipientSearchRow[] = [];
  let degraded = false;

  try {
    const res = await searchRecipients({
      search: keyword || undefined,
      naics: naics || undefined,
      state: state || undefined,
      sortBy,
      limit,
      // Authenticated + credit-metered call — go straight to live BigQuery.
      // Without this the cache-only default returns 0 on a cold cache.
      liveBq: true,
    });
    contractors = res.rows || [];
  } catch (err) {
    degraded = true;
    console.error('[mcp:search_contractors] search failed:', err);
  }

  const grounded = contractors.length > 0;
  const result: SearchContractorsResult = {
    queried: {
      ...(keyword ? { keyword } : {}),
      ...(naics ? { naics } : {}),
      ...(state ? { state } : {}),
      sort_by: sortBy,
    },
    contractors,
    _meta: { grounded, degraded, count: contractors.length },
  };

  if (mcpFlags.aiHint) {
    const top = contractors[0];
    result._ai_hint = {
      summary: degraded
        ? 'Contractor search backend (BigQuery) errored — retry; do NOT state the market is empty.'
        : grounded
        ? `${contractors.length} contractor${contractors.length === 1 ? '' : 's'} match. Top by ${sortBy}: ${top.recipient_name} ($${Math.round(top.total_obligated).toLocaleString()} obligated, ${top.award_count} awards, ${top.distinct_agency_count} agencies).`
        : `No rows returned for ${keyword || naics || state || 'that query'}. This can mean a genuinely thin market OR a temporary data-source limit — try a broader NAICS prefix / drop the state, and if it stays empty, retry later. Do NOT assert "no such contractors exist."`,
      how_to_use: grounded
        ? 'Use total_obligated to size competitors, distinct_agency_count to spot broad sellers vs. single-buyer firms (teaming targets), and award_count for cadence. These are historical federal totals, not a bid list.'
        : 'No grounded rows; say the search returned nothing (possibly a data-source limit) rather than naming any contractor or claiming the market is empty.',
      key_caveats: [
        'Dollars are cumulative historical obligations from USASpending, not current-year or a guarantee of future work.',
        'NAICS shorter than 6 digits is treated as a prefix (e.g. "236" matches all 236xxx).',
        'An empty result does not necessarily mean an empty market — the BigQuery source can rate/quota-limit and returns empty rather than an error.',
      ],
    };
  }

  return result;
}
