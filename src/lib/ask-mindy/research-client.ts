/**
 * The Anthropic client for research mode.
 *
 * The SDK refuses a NON-streaming request whose max_tokens implies more than 10 minutes of generation
 * ("Streaming is required for operations that may take longer than 10 minutes") — but only when the CLIENT has no
 * timeout of its own; a per-request timeout does not skip that check. The report step asks for
 * REPORT_STEP_MAX_TOKENS (32K), which the SDK estimates at ~15 minutes, so a bare `new Anthropic()` threw before
 * sending and every research turn that asked for a report ended in the generic error (production, 2026-11-27,
 * the first day report documents were switched on). Every step still carries its own shorter per-request timeout.
 */
import Anthropic from '@anthropic-ai/sdk';
import { RESEARCH_TURN_MS } from './research-mode';

export function researchClient(opts: ConstructorParameters<typeof Anthropic>[0] = {}): Anthropic {
  return new Anthropic({ timeout: RESEARCH_TURN_MS, ...opts });
}
