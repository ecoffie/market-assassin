/**
 * Neutral refusals for the ChatGPT profile endpoint (/chatgpt/mcp).
 *
 * Owner decision 2 (tasks/chatgpt-plugin-path-a.md): the ChatGPT surface carries NO
 * prices, purchase/top-up links, upgrade pitches, checkout, continue_url, or saved
 * purchase retries. A refusal states the fact (what was needed, what the account has,
 * that nothing was charged) and that account credits are managed outside the chat.
 *
 * The Claude/general endpoint keeps its own copy (commercial-refusal.ts + paywall.ts)
 * byte-for-byte — this module is only ever reached on the ChatGPT path.
 *
 * Shape: the existing structured refusal contract (error_code, required/available
 * credits, retryable:false, tool_name, message) MINUS its commerce fields
 * (continuation_available, continue_url). Returned as a non-error tool result, for the
 * same reason as the Claude edge: an isError refusal makes the host invent "the server
 * is down, let me retry".
 *
 * Copy rule (enforced by chatgpt-profile.unit.test.ts): none of
 *   $ · price · buy · purchase · top up · upgrade · subscribe · checkout · stripe ·
 *   getmindy.ai/mcp · continue
 */

export const NEUTRAL_MANAGED_OUTSIDE = 'Account credits are managed outside this chat.';

export function neutralInsufficientCreditsMessage(required: number, available: number | null | undefined): string {
  return typeof available === 'number'
    ? `This request needs ${required} credits and the account has ${available}. Nothing was charged. ${NEUTRAL_MANAGED_OUTSIDE}`
    : `This request needs ${required} credits and the account does not have enough. Nothing was charged. ${NEUTRAL_MANAGED_OUTSIDE}`;
}

export function neutralPoolInsufficientMessage(required: number | null, available: number | null | undefined): string {
  const need = typeof required === 'number' ? `${required} credits` : 'more credits';
  return typeof available === 'number'
    ? `This request needs ${need} and the team's shared credit pool has ${available}. Nothing was charged. ${NEUTRAL_MANAGED_OUTSIDE}`
    : `This request needs ${need} and the team's shared credit pool does not have enough. Nothing was charged. ${NEUTRAL_MANAGED_OUTSIDE}`;
}

export const NEUTRAL_REQUIRES_PRO_MESSAGE =
  "This tool isn't available on this account's current plan. Nothing was charged.";

export const NEUTRAL_REQUIRES_PAID_MESSAGE =
  "This tool isn't available to this account right now. Nothing was charged.";

export const NEUTRAL_RATE_LIMITED_MESSAGE =
  'This account has reached its usage limit for this tool for now. Nothing was charged. Try again later.';

export const NEUTRAL_BILLING_UNRESOLVED_MESSAGE =
  'We could not determine which account to use for this request. Nothing was charged.';

/** Codes that are refusals (a decision about the account), not tool failures. */
export const CHATGPT_REFUSAL_CODES = new Set([
  'insufficient_credits',
  'team_pool_insufficient_credits',
  'requires_pro',
  'requires_paid_credits',
  'rate_limited',
  'billing_account_unresolved',
]);

export interface ChatgptRefusal {
  error_code: string;
  required_credits: number | null;
  available_credits: number | null;
  credits_needed: number | null;
  retryable: false;
  tool_name: string;
  message: string;
}

/**
 * Build the neutral refusal for a metered error code. Numbers come from the structured
 * fields the metering layer already computed — never parsed out of prose.
 */
export function buildChatgptRefusal(opts: {
  code: string;
  toolName: string;
  requiredCredits?: number | null;
  availableCredits?: number | null;
}): ChatgptRefusal {
  const required = typeof opts.requiredCredits === 'number' ? opts.requiredCredits : null;
  const available = typeof opts.availableCredits === 'number' ? opts.availableCredits : null;
  const needed = required !== null && available !== null ? Math.max(0, required - available) : null;
  let message: string;
  switch (opts.code) {
    case 'insufficient_credits':
      message = required !== null
        ? neutralInsufficientCreditsMessage(required, available)
        : `This account does not have enough credits for this request. Nothing was charged. ${NEUTRAL_MANAGED_OUTSIDE}`;
      break;
    case 'team_pool_insufficient_credits':
      message = neutralPoolInsufficientMessage(required, available);
      break;
    case 'requires_pro':
      message = NEUTRAL_REQUIRES_PRO_MESSAGE;
      break;
    case 'requires_paid_credits':
      message = NEUTRAL_REQUIRES_PAID_MESSAGE;
      break;
    case 'rate_limited':
      message = NEUTRAL_RATE_LIMITED_MESSAGE;
      break;
    default:
      message = NEUTRAL_BILLING_UNRESOLVED_MESSAGE;
  }
  return {
    error_code: opts.code.toUpperCase(),
    required_credits: required,
    available_credits: available,
    credits_needed: needed,
    retryable: false,
    tool_name: opts.toolName,
    message,
  };
}
