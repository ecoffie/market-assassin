/**
 * Mindy MCP tool registry — the transport-agnostic catalog + dispatcher.
 *
 * Phase 1 Slice 2. The hosted HTTP transport (added with the mcp.getmindy.ai
 * subdomain) calls `listMcpTools()` for tools/list and `runMcpTool()` for
 * tools/call. This layer is deliberately independent of the transport AND of
 * billing:
 *   - It REUSES the already-wired chat toolsets (Tier-1 public data + Tier-2
 *     intelligence) via their `execute(name,args)` interface — zero re-implementation.
 *   - Tier-0 (pipeline/Vault, private PII) is intentionally EXCLUDED from v1
 *     (PRD §6 — its own hardening pass is Phase 2).
 *   - Per-tool credit prices are surfaced as metadata here, but NOTHING is debited
 *     yet. The atomic debit-on-success + get_balance land in Slice 3 (money slice),
 *     which will wrap runMcpTool.
 *
 * Data-first: tools return their raw grounded results. Optional narration/enrichment
 * stays gated by mcpFlags (see src/lib/mcp/flags.ts).
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { makeTier1Tools, TIER1_TOOL_DEFS, TIER1_TOOL_NAMES, type Tier1Db } from '@/lib/chat/tier1-tools';
import { makeTier2Tools, TIER2_TOOL_DEFS, TIER2_TOOL_NAMES } from '@/lib/chat/tier2-tools';
import { getWinningPlaybook } from '@/mcp/tools/winning-playbook';
import { getBalance } from '@/lib/mcp/credits';

export interface McpToolContext {
  /** The verified key owner — used for user-bound tools + (Slice 3) the debit. */
  userEmail: string;
}

/**
 * Per-tool credit price. Debited on success in Slice 3; exposed as `_credits` now so
 * clients/docs can show the price. Prices mirror PRD §4 (tune later): cheap data
 * lookups = 1, a live-BQ contractor profile = 5, a capable-contractors scan = 8, the
 * proprietary playbook = 2.
 */
export const TOOL_CREDITS: Readonly<Record<string, number>> = {
  search_sam_opportunities: 1,
  get_market_vocabulary: 1,
  get_contractor_profile: 5,
  find_capable_contractors: 8,
  get_winning_playbook: 2,
  get_balance: 0, // meta tool — always free
};

/** Free meta-tool: report the caller's live credit balance. */
const GET_BALANCE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_balance',
    description: 'Return the caller\'s current Mindy MCP credit balance. Free (0 credits).',
    parameters: { type: 'object', properties: {} },
  },
};

/** OpenAI-style def for the playbook tool (mirrors src/mcp/server.ts's zod schema). */
const PLAYBOOK_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_winning_playbook',
    description:
      "GovCon Giants' proprietary coaching on HOW TO WIN a federal contracting scenario, " +
      'from 8 years of course/proposal/podcast content. Teaching intelligence, not a public ' +
      'data lookup. Optionally pass NAICS for a matched real contractor win story.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The scenario in plain language.' },
        naics_codes: { type: 'array', items: { type: 'string' }, description: 'Optional NAICS (4-6 digit).' },
        limit: { type: 'number', description: 'Max guidance passages (default 6).' },
      },
      required: ['topic'],
    },
  },
};

/** All tools exposed over MCP in v1, each annotated with its credit price. */
export function listMcpTools(): Array<Record<string, unknown>> {
  const defs = [...TIER1_TOOL_DEFS, ...TIER2_TOOL_DEFS, PLAYBOOK_TOOL_DEF, GET_BALANCE_TOOL_DEF];
  return defs.map((d) => ({ ...d, _credits: TOOL_CREDITS[d.function.name] ?? 0 }));
}

/** Is `name` a tool this server exposes? (Fast reject for unknown calls.) */
export function isMcpTool(name: string): boolean {
  return (
    TIER1_TOOL_NAMES.has(name) ||
    TIER2_TOOL_NAMES.has(name) ||
    name === 'get_winning_playbook' ||
    name === 'get_balance'
  );
}

/** The credit price for a tool (0 if unknown/free). */
export function creditsFor(name: string): number {
  return TOOL_CREDITS[name] ?? 0;
}

export interface McpToolRun {
  /** The tool's raw result (data-first; narration stays flag-gated). */
  result: Record<string, unknown>;
  /** Credits this call WOULD cost — Slice 3 debits this on success. */
  credits: number;
}

/**
 * Run a tool by name with model-supplied args, as the given identity. Reuses the
 * existing chat toolsets' execute(). Throws on an unknown tool (the transport maps
 * that to an MCP error). Does NOT debit — that's Slice 3.
 */
export async function runMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<McpToolRun> {
  const credits = creditsFor(name);

  if (TIER1_TOOL_NAMES.has(name)) {
    // Public data — no user binding. Service-role client adapts to the minimal
    // Tier1Db structural interface (same client the chat route passes; the strict
    // supabase-js generics just don't match the loose interface at the type level).
    const result = await makeTier1Tools(getWriteClient() as unknown as Tier1Db).execute(name, args);
    return { result, credits };
  }

  if (TIER2_TOOL_NAMES.has(name)) {
    // Intelligence tools — user email is the BQ cold-lookup rate-limit key (the
    // Tier-2 cost guard carries over to the MCP edge, per the PRD acceptance gate).
    const result = await makeTier2Tools(ctx.userEmail).execute(name, args);
    return { result, credits };
  }

  if (name === 'get_winning_playbook') {
    const result = (await getWinningPlaybook({
      topic: String(args.topic ?? ''),
      naics_codes: Array.isArray(args.naics_codes) ? (args.naics_codes as string[]) : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_balance') {
    const balance = await getBalance(ctx.userEmail);
    return { result: { balance }, credits };
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}
