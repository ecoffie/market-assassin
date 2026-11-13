/**
 * Which mcp_call_log rows are MCP usage (and which are native Ask Mindy usage).
 *
 * mcp_call_log is shared: MCP surfaces and, since the Ask Mindy safety release, the in-app
 * chat (channel 'app_chat') both write it, so one log holds every tool execution with its
 * credit price. MCP-specific readers (the extraction guard, the MCP Usage/Activity panels,
 * MCP cohort analytics, the MCP activation digest) must count only MCP rows.
 *
 * MCP rows are identified by EXCLUSION, never by a positive channel value:
 *   - channel IS NULL   → Claude/general MCP edge (it never writes a channel) and every row
 *                         written before 2026-10-03 (the channel column did not exist)
 *   - channel = 'chatgpt' → /chatgpt/mcp
 *   - channel = 'app_chat' → Ask Mindy — NOT MCP usage
 * There is no channel 'mcp' value; filtering on one would drop all historical MCP usage.
 *
 * Note the NULL trap: in SQL `channel <> 'app_chat'` is NULL (not true) for a NULL channel,
 * so the filter must be `channel IS NULL OR channel <> 'app_chat'`.
 */
export const ASK_MINDY_CHANNEL = 'app_chat' as const;

/** PostgREST `.or()` argument that keeps every MCP row (NULL channel included). */
export const MCP_CHANNEL_OR_FILTER = `channel.is.null,channel.neq.${ASK_MINDY_CHANNEL}`;

/** Equivalent SQL predicate (for SQL-level tests and ad-hoc reconciliation queries). */
export const MCP_CHANNEL_SQL = `(channel IS NULL OR channel <> '${ASK_MINDY_CHANNEL}')`;

/** In-memory form of the same rule, for rows already fetched. */
export function isMcpUsageRow(row: { channel?: string | null }): boolean {
  return row.channel == null || row.channel !== ASK_MINDY_CHANNEL;
}

/** Apply the MCP-only filter to a PostgREST query builder. */
export function onlyMcpChannels<Q extends { or: (filters: string) => Q }>(query: Q): Q {
  return query.or(MCP_CHANNEL_OR_FILTER);
}
