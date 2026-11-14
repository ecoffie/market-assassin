/**
 * Ask Mindy chat tool policy — the ONE place that decides which Mindy tools the in-app chat
 * may OFFER to a model and may EXECUTE. Both checks read this file (see chat-tool-executor.ts),
 * so a tool name the model invents, or one injected through conversation text, is refused
 * before any tool code runs.
 *
 * Approved 2026-11-13 (Ask Mindy safety release, Option C):
 *   - Tools hidden from public MCP as `hide_until_fixed` are blocked here too. A tool unblocks
 *     in chat only when it is fixed for MCP (HIDDEN_FROM_PUBLIC_MCP is the source).
 *   - Destructive operations, external-system writes and high-impact operations need a
 *     SERVER-ISSUED confirmation token. Those tokens do not exist yet (Phase 3), so these
 *     tools are blocked in chat until then. A model-supplied `confirm: true` is never a
 *     confirmation — the executor strips it.
 *   - D1: `generate_market_report` is blocked in chat until the confirmation controls ship.
 *     It stays available through its existing app route and MCP.
 *   - Low-risk, reversible, owner-scoped writes (create an alert, rename/pause it) run when
 *     clearly requested, capped at one write per tool round.
 *
 * FAIL-CLOSED:
 *   - A tool with a write classification in TOOL_META that is not explicitly classified below
 *     resolves to `requires_confirmation` (blocked).
 *   - A tool that is not registered at all resolves to `blocked_chat_exception`.
 *   chat-tool-policy.unit.test.ts fails if a registered write tool is unclassified.
 */
import { HIDDEN_FROM_PUBLIC_MCP } from '@/lib/mcp/public-catalog-config';
import { toolWriteKind } from '@/lib/mcp/tool-schemas';

export type ChatToolDecision =
  | 'allowed_read'
  | 'allowed_write'
  | 'requires_confirmation'
  | 'blocked_defect'
  | 'blocked_chat_exception';

export interface ChatToolPolicy {
  decision: ChatToolDecision;
  /** Internal reason (logged). */
  reason: string;
  /** Plain-English line the model can relay to the user when the tool is refused. */
  userMessage?: string;
}

/** Explicit chat decisions. Anything not listed falls through to the rules in chatToolPolicy. */
const CHAT_OVERRIDES: Readonly<Record<string, ChatToolPolicy>> = {
  // ── Low-risk, reversible, owner-scoped writes ──
  schedule_market_search: {
    decision: 'allowed_write',
    reason: 'Creates a saved-search alert owned by the session user; fingerprint-idempotent (saved-searches/service.ts).',
  },
  update_market_schedule: {
    decision: 'allowed_write',
    reason: 'Renames or changes the cadence/enabled state of the session user\'s own alert; reversible.',
  },

  // ── Need a server-issued confirmation (Phase 3); blocked until then ──
  delete_market_schedule: {
    decision: 'requires_confirmation',
    reason: 'Destructive. Needs a server-issued confirmation token (Phase 3).',
    userMessage:
      'Deleting an alert needs your confirmation, which chat cannot collect yet. You can delete it from Saved Searches on the Opportunity Map.',
  },
  add_contacts_to_crm: {
    decision: 'requires_confirmation',
    reason: 'External CRM write (GoHighLevel upsert can overwrite contacts).',
    userMessage: 'Adding contacts to your CRM is not available from chat yet.',
  },
  generate_market_report: {
    decision: 'requires_confirmation',
    reason: 'D1 (2026-11-13): blocked in chat until confirmation controls ship. Creates a public share link; 100-credit operation on MCP.',
    userMessage:
      'Creating a saved market report is not available from chat yet. You can generate one from the Market Report page, and I can still research the market for you here.',
  },

  // ── Chat-specific exceptions ──
  verify_m_scale: {
    decision: 'blocked_chat_exception',
    reason: 'Internal QA oracle (npm run verify:m-scale), not a customer job.',
  },
  export_proposal: {
    decision: 'blocked_chat_exception',
    reason: 'Returns a base64 .docx into model context that never reaches the user. Re-enable with artifact delivery (Phase 2).',
    userMessage: 'Exporting a proposal file is not available from chat yet. Use Proposal Assist to export.',
  },
  get_balance: {
    decision: 'blocked_chat_exception',
    reason: 'MCP credit-meter tool; not meaningful in chat.',
  },
  get_winning_playbook: {
    decision: 'blocked_chat_exception',
    reason: 'Teaching corpus removed from Ask Mindy (Eric 2026-08-02).',
  },
  search_podcast_lessons: {
    decision: 'blocked_chat_exception',
    reason: 'Teaching corpus removed from Ask Mindy (Eric 2026-08-02).',
  },
};

/** The chat-only private tools (session-email-bound). Read-only. */
export const CHAT_PRIVATE_READ_TOOLS: ReadonlySet<string> = new Set(['get_my_pipeline', 'search_my_vault']);

/**
 * Decide what chat may do with a tool.
 * @param isRegistered whether the name is a registered MCP tool or a chat-private tool.
 */
export function chatToolPolicy(name: string, isRegistered: boolean): ChatToolPolicy {
  if (!isRegistered) {
    return { decision: 'blocked_chat_exception', reason: `unknown_tool:${name}` };
  }
  if (CHAT_PRIVATE_READ_TOOLS.has(name)) {
    return { decision: 'allowed_read', reason: 'chat-private read tool bound to the session user' };
  }
  const hidden = HIDDEN_FROM_PUBLIC_MCP[name];
  if (hidden?.decision === 'hide_until_fixed') {
    return {
      decision: 'blocked_defect',
      reason: `hide_until_fixed: ${hidden.reason}`,
      userMessage: 'That capability is temporarily unavailable while a known issue is fixed.',
    };
  }
  const override = CHAT_OVERRIDES[name];
  if (override) return override;
  if (toolWriteKind(name)) {
    // A write tool nobody classified for chat. Never let it run by default.
    return {
      decision: 'requires_confirmation',
      reason: 'unclassified write tool (fail-closed)',
      userMessage: 'That action is not available from chat yet.',
    };
  }
  return { decision: 'allowed_read', reason: 'read-only tool' };
}

/** True when chat may offer the tool to a model. */
export function isChatOfferable(policy: ChatToolPolicy): boolean {
  return policy.decision === 'allowed_read' || policy.decision === 'allowed_write';
}

/** Explicitly classified names (exported for the completeness test). */
export const CHAT_OVERRIDE_NAMES: readonly string[] = Object.keys(CHAT_OVERRIDES);
