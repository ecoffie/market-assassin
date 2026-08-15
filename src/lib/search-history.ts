/**
 * Record what customers actually search — server-side, for the paths the browser
 * capture route never sees.
 *
 * WHY THIS EXISTS
 * `user_search_history` is the instrument for "what do our customers look for?", and
 * it answers only for the surfaces that write to it. Audited 2026-08-15: 778 rows /
 * 44 users, and `keyword`-type rows = ZERO — not because nobody searches by text, but
 * because only the browser tools POST to /api/search-capture. The keyword paths that
 * matter most for market vocabulary (market reports, MCP search tools) run
 * server-side and logged nothing.
 *
 * That blind spot led me to recommend hand-curating market expansions "one by one"
 * off an 18-keyword sample, when the real instrument had 778 rows and said something
 * different. A measurement gap in the thing you measure decisions WITH is expensive.
 *
 * DESIGN
 *  • Fire-and-forget. A logging failure must NEVER break a search or a report — every
 *    path here swallows its error after logging it. The caller does not await a write
 *    it does not need.
 *  • Server-side insert, not a fetch to /api/search-capture. Calling our own HTTP
 *    route from a server route adds a hop, a timeout, and an auth surface for no gain.
 *  • Same table, same column contract, same VALID_TOOLS/VALID_SEARCH_TYPES vocabulary
 *    as the browser route, so both write comparable rows.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Mirrors VALID_TOOLS in /api/search-capture — keep the two in sync. */
export type SearchTool =
  | 'market_assassin'
  | 'recompete'
  | 'opportunity_hunter'
  | 'contractor_db'
  | 'content_generator'
  | 'opportunity_map'
  | 'market_report'
  | 'mcp';

/** Mirrors VALID_SEARCH_TYPES in /api/search-capture. */
export type SearchKind = 'naics' | 'agency' | 'keyword' | 'company' | 'zip' | 'contract' | 'psc' | 'set_aside';

export interface SearchHistoryEntry {
  userEmail: string | null | undefined;
  tool: SearchTool;
  searchType: SearchKind;
  searchValue: string | null | undefined;
  /** Anything that helps interpret the row later (naics, agency, tool name…). */
  metadata?: Record<string, unknown>;
}

/**
 * Log one search. Never throws, never blocks — call without awaiting when the caller
 * has nothing to do with the result.
 */
export async function recordSearch(entry: SearchHistoryEntry): Promise<void> {
  const email = (entry.userEmail || '').toLowerCase().trim();
  const value = (entry.searchValue || '').trim();
  // No email or no value = nothing worth a row. Anonymous searches would skew the
  // per-user reads this table exists for.
  if (!email || !value) return;

  try {
    const { error } = await getWriteClient()
      .from('user_search_history')
      .insert({
        user_email: email,
        tool: entry.tool,
        search_type: entry.searchType,
        search_value: value,
        search_metadata: entry.metadata ?? {},
      });
    // Surface the error, never rethrow: the search itself already succeeded, and a
    // logging failure must not turn a working report into a 500.
    if (error) console.error('[search-history] insert failed:', error.message);
  } catch (err) {
    console.error('[search-history] insert threw:', err);
  }
}

/**
 * Log every axis of a multi-axis search as its own row.
 *
 * A market report scoped to keyword + NAICS + agency is THREE facts about what this
 * customer looks for, and collapsing them into one row loses the two that would tell
 * you which axis people actually use. Returns immediately; writes in the background.
 */
export function recordSearchAxes(
  userEmail: string | null | undefined,
  tool: SearchTool,
  axes: Partial<Record<SearchKind, string | null | undefined>>,
  metadata?: Record<string, unknown>,
): void {
  for (const [kind, value] of Object.entries(axes)) {
    if (!value) continue;
    void recordSearch({ userEmail, tool, searchType: kind as SearchKind, searchValue: value, metadata });
  }
}
