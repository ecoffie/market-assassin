/**
 * The PUBLIC MCP catalog — which registered tools an external MCP host may LIST and CALL.
 *
 * TWO LISTS, TWO JOBS (do not merge them):
 *   listMcpTools()        (tool-registry.ts) — the INTERNAL registry. Every tool Mindy can
 *                         dispatch. Mindy Chat, internal composition and runMcpTool read it.
 *   listPublicMcpTools()  (this file)        — what an EXTERNAL MCP client sees on
 *                         mcp.getmindy.ai: tools/list, /api/mcp/catalog, /mcp/tools,
 *                         /mcp/about, and the catalog drift gate.
 *
 * Hiding a tool here NEVER deletes its implementation. It stays registered, stays
 * callable from Mindy Chat, and stays composable inside other tools (the dossier still
 * calls the EDGAR financials lib; one_click still runs the export/structure steps).
 *
 * FAIL-CLOSED: a tool is public only if it is named in PUBLIC_MCP_TOOLS. A newly
 * registered tool is NOT published until someone classifies it here, and
 * public-catalog.unit.test.ts fails until every registered tool is in exactly one of
 * PUBLIC_MCP_TOOLS / HIDDEN_FROM_PUBLIC_MCP. Publishing a tool is a product decision,
 * not a side effect of registering it.
 *
 * Source of the hidden set: tasks/mcp-tool-portfolio-audit-2026-10-02.md, Phase 1,
 * approved by Eric 2026-10-02 (12 candidates → 11: match_company_to_pathways stays
 * public because it is the CAI → Pathway Fit → Talent Thin step of the live Potato
 * journey, not a redundant door).
 *
 * No dispatch aliases are kept for the hidden tools: measured over 90 days, ZERO
 * customer calls to any of them came through an API key (scripts/integrations). Every
 * customer call came from an OAuth host, which re-reads tools/list on connect.
 */
import { listMcpTools } from '@/lib/mcp/tool-registry';
import {
  PUBLIC_MCP_TOOLS,
  HIDDEN_FROM_PUBLIC_MCP,
  isPublicMcpTool,
} from '@/lib/mcp/public-catalog-config';

export {
  PUBLIC_MCP_TOOLS,
  HIDDEN_FROM_PUBLIC_MCP,
  isPublicMcpTool,
  type HiddenDecision,
  type HiddenToolEntry,
} from '@/lib/mcp/public-catalog-config';


function toolName(t: Record<string, unknown>): string {
  return ((t.function as { name?: string } | undefined)?.name) ?? '';
}

/** The external catalog: listMcpTools() filtered to the allowlist, registry order kept. */
export function listPublicMcpTools(): Array<Record<string, unknown>> {
  return listMcpTools().filter((t) => isPublicMcpTool(toolName(t)));
}

/**
 * Classification audit for tests and the drift gate. Every registered tool must be in
 * exactly one list; every listed name must be registered.
 */
export function auditPublicCatalog(registered: readonly string[] = listMcpTools().map(toolName)): {
  unclassified: string[];
  both: string[];
  unknownPublic: string[];
  unknownHidden: string[];
} {
  const reg = new Set(registered);
  const hidden = Object.keys(HIDDEN_FROM_PUBLIC_MCP);
  const hiddenSet = new Set(hidden);
  const publicSet = new Set(PUBLIC_MCP_TOOLS);
  return {
    unclassified: registered.filter((n) => !publicSet.has(n) && !hiddenSet.has(n)),
    both: PUBLIC_MCP_TOOLS.filter((n) => hiddenSet.has(n)),
    unknownPublic: PUBLIC_MCP_TOOLS.filter((n) => !reg.has(n)),
    unknownHidden: hidden.filter((n) => !reg.has(n)),
  };
}
