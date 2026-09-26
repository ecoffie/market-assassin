/**
 * Retired MCP tools — names that were once published and must now answer stale clients clearly.
 *
 * A retired tool is:
 *   • ABSENT from discovery — not in listMcpTools()/mcpRegistrationList(), TOOL_CREDITS,
 *     the tool groups, the stdio server, or any catalog. (Guarded by retired-tools.unit.test.ts.)
 *   • NEVER charged — a stale `tools/call` gets a clear "retired" result, logged with
 *     status 'retired' and 0 credits, and never reaches runMcpTool or the debit.
 *
 * Why an explicit list instead of letting the SDK say "Tool not found": a client that cached the
 * old tool list (Claude Desktop, a saved agent) would get a bare protocol error and tend to retry
 * or report the server as broken. The retired answer says what happened and that nothing was billed.
 *
 * ⚠️ Adding a name here is a one-way door: the registry test fails if a retired name is ever
 * registered again. To bring a tool back, remove it from this list in the same change.
 */

export interface RetiredTool {
  retired_on: string; // YYYY-MM-DD
  /** Plain-English reason shown to the caller. */
  reason: string;
  /** What the caller can do instead. Never names a Mindy tool that cannot do the job. */
  instead: string;
}

export const RETIRED_TOOLS: Readonly<Record<string, RetiredTool>> = {
  // Retired 2026-09-26 after the Reed Analytics investigation (tasks/sbir-reed-investigation-2026-09-26.md):
  // it could not return open SBIR/STTR topics — its only open-topic source (the DoD cache) never
  // received a row, its "multisite" source errored on every call, and its default returned NIH
  // award history in a field named `opportunities`. The shared NIH/DoD libraries and stored data
  // are kept (src/lib/sbir/*); only the published tool is withdrawn.
  search_sbir: {
    retired_on: '2026-09-26',
    reason: 'Mindy does not currently provide a reliable source of OPEN SBIR/STTR topics, so this tool has been withdrawn rather than return award history in their place.',
    instead: 'For open SBIR/STTR topics and deadlines, use SBIR.gov (sbir.gov/topics) or the DoD SBIR/STTR portal (DSIP) directly.',
  },
};

export function isRetiredTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_TOOLS, name);
}

export function retiredToolMessage(name: string): string {
  const t = RETIRED_TOOLS[name];
  return `${name} was retired on ${t.retired_on} and is no longer available. ${t.reason} ${t.instead} No credits were charged for this call.`;
}

/**
 * The MCP `CallToolResult` for a stale call. `isError: false` on purpose — the same contract as the
 * commercial refusals: hosts read isError as "the server crashed, retry", and a retry cannot help.
 */
export function retiredToolResult(name: string) {
  const t = RETIRED_TOOLS[name];
  const structured = {
    error: {
      code: 'tool_retired' as const,
      tool: name,
      retired_on: t.retired_on,
      message: retiredToolMessage(name),
      credits_charged: 0,
    },
  };
  return {
    isError: false,
    content: [
      { type: 'text' as const, text: retiredToolMessage(name) },
      { type: 'text' as const, text: JSON.stringify(structured) },
    ],
    structuredContent: structured,
  };
}

interface JsonRpcCall {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: unknown };
}

/**
 * Inspect a POSTed JSON-RPC body. Returns the retired tool's name + request id when the body is a
 * SINGLE `tools/call` for a retired tool; otherwise null (the request proceeds to the SDK untouched).
 * A JSON-RPC batch is left to the SDK, which answers a retired name with "Tool not found" — still
 * uncharged, because an unregistered tool never reaches runMeteredTool.
 */
export function matchRetiredToolCall(body: unknown): { name: string; id: string | number | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const msg = body as JsonRpcCall;
  if (msg.method !== 'tools/call') return null;
  const name = msg.params?.name;
  if (typeof name !== 'string' || !isRetiredTool(name)) return null;
  return { name, id: msg.id ?? null };
}

/** The JSON-RPC response body for a matched stale call. */
export function retiredToolJsonRpcResponse(match: { name: string; id: string | number | null }) {
  return { jsonrpc: '2.0' as const, id: match.id, result: retiredToolResult(match.name) };
}
