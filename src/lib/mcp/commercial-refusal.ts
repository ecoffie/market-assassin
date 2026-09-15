/**
 * Structured commercial refusal for MCP tool calls.
 *
 * WHY THIS EXISTS (2026-09-15 incident): capability_market_match was refused for
 * insufficient credits (45 available / 50 required). The hosted transport returned
 * `isError: true` with a prose paywall string. Claude treated that as a transient
 * tool/server failure ("Mindy's server isn't responding — let me retry once") instead
 * of a commercial gate. Prose is not a contract; agents invent retry language.
 *
 * Contract rules:
 *   - Machine fields are authoritative. Do not parse the message for credits.
 *   - retryable is ALWAYS false for commercial refusals — never invite automatic retry.
 *   - continuation_available is true when the attempt was saved for /mcp/continue.
 *   - Transport MUST NOT set MCP isError for these codes (see mcpToolResultFromMeteredError).
 */

export const INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS' as const;
export const REQUIRES_PRO = 'REQUIRES_PRO' as const;

export type CommercialErrorCode = typeof INSUFFICIENT_CREDITS | typeof REQUIRES_PRO;

/** Metered / legacy snake_case codes that map onto the commercial contract. */
export type CommercialMeteredCode = 'insufficient_credits' | 'requires_pro';

export interface CommercialRefusal {
  error_code: CommercialErrorCode;
  required_credits: number | null;
  available_credits: number | null;
  /** Positive shortfall when both sides are known; otherwise null (never fabricate). */
  credits_needed: number | null;
  /** Always false — commercial refusals are not transient. */
  retryable: false;
  continuation_available: boolean;
  continue_url: string | null;
  tool_name: string;
  /** Customer-facing explanation the agent should relay verbatim. */
  message: string;
}

export function isCommercialMeteredCode(code: string): code is CommercialMeteredCode {
  return code === 'insufficient_credits' || code === 'requires_pro';
}

/**
 * Lead line for insufficient credits — exact numbers, no "server" language.
 * Unknown balance: state cost only (unknown is not zero).
 */
export function insufficientCreditsLead(required: number, available: number | undefined): string {
  if (typeof available === 'number') {
    return `You need ${required} credits to run this analysis. You currently have ${available}.`;
  }
  return `You need ${required} credits to run this analysis.`;
}

export function buildInsufficientCreditsRefusal(opts: {
  toolName: string;
  requiredCredits: number;
  availableCredits: number;
  /** Full customer message (lead + offer + continue). */
  message: string;
  continueUrl?: string | null;
}): CommercialRefusal {
  const needed = Math.max(0, opts.requiredCredits - opts.availableCredits);
  return {
    error_code: INSUFFICIENT_CREDITS,
    required_credits: opts.requiredCredits,
    available_credits: opts.availableCredits,
    credits_needed: needed,
    retryable: false,
    continuation_available: Boolean(opts.continueUrl),
    continue_url: opts.continueUrl ?? null,
    tool_name: opts.toolName,
    message: opts.message,
  };
}

export function buildRequiresProRefusal(opts: {
  toolName: string;
  message: string;
  continueUrl?: string | null;
}): CommercialRefusal {
  return {
    error_code: REQUIRES_PRO,
    required_credits: null,
    available_credits: null,
    credits_needed: null,
    retryable: false,
    continuation_available: Boolean(opts.continueUrl),
    continue_url: opts.continueUrl ?? null,
    tool_name: opts.toolName,
    message: opts.message,
  };
}

/**
 * Shape the hosted MCP tool result for a metered outcome.
 * Commercial refusals are successful MCP tool *responses* carrying a refusal payload —
 * never isError (that is what made Claude invent "server isn't responding").
 */
export function mcpToolResultFromMeteredError(error: {
  code: string;
  message: string;
  commercial?: CommercialRefusal;
}): {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
} {
  if (error.commercial && isCommercialMeteredCode(error.code)) {
    const refusal = error.commercial;
    return {
      // Explicit false — omit alone still typed as optional; false documents the contract.
      isError: false,
      content: [
        { type: 'text', text: refusal.message },
        // Second block: machine-readable contract for clients that ignore structuredContent.
        { type: 'text', text: JSON.stringify(refusal) },
      ],
      structuredContent: { ...refusal },
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
  };
}
