/**
 * Ask Mindy turn deadlines (audit A7) and the incomplete-lookup notice (audit A6).
 *
 * Before this module the chat route had NO timeout anywhere: no per-tool, planner, answer or overall
 * deadline, and no route maxDuration. A tool or provider that never answered left the browser waiting
 * until the platform killed the function, and the stream ended with no `error` or `done` event — a
 * silent, blank answer. Every wait in a turn is now bounded:
 *
 *   planner attempt ........ plannerMs           (each fallback planner gets its own attempt)
 *   one tool call .......... toolMs              (longer for the Vault-grounded drafting tools)
 *   the whole tool round ... toolRoundBudgetMs   (calls after it are refused, never run)
 *   answer connect ......... answerConnectMs     (headers; then the next fallback model is tried)
 *   answer stream idle ..... answerIdleMs        (no new bytes → the answer is cut and flagged)
 *   whole turn ............. turnMs              (watchdog: error + done, card turn released)
 *
 * turnMs sits below the route's maxDuration (300 s), so the watchdog always fires before the platform
 * kills the function. Each value can be lowered per environment with the CHAT_* variables below (tests
 * use milliseconds); a missing, zero, negative or non-numeric value falls back to the default.
 */

export interface ChatDeadlines {
  toolMs: number;
  toolRoundBudgetMs: number;
  plannerMs: number;
  answerConnectMs: number;
  answerIdleMs: number;
  turnMs: number;
  /** True when CHAT_TOOL_TIMEOUT_MS was set: it then applies to every tool, overrides included. */
  toolMsFromEnv: boolean;
}

/** The route's `maxDuration` (seconds). Kept here so the watchdog can be checked against it. */
export const CHAT_ROUTE_MAX_DURATION_S = 300;

export const DEFAULT_CHAT_DEADLINES: Omit<ChatDeadlines, 'toolMsFromEnv'> = {
  plannerMs: 30_000,
  toolMs: 45_000,
  toolRoundBudgetMs: 150_000,
  answerConnectMs: 30_000,
  answerIdleMs: 45_000,
  turnMs: 285_000,
};

/** Tools that legitimately run longer than an ordinary lookup (multi-section Vault-grounded drafts). */
export const TOOL_TIMEOUT_OVERRIDES_MS: Readonly<Record<string, number>> = {
  draft_proposal: 140_000,
  draft_proposal_section: 90_000,
};

function positiveInt(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function chatDeadlines(env: Record<string, string | undefined> = process.env): ChatDeadlines {
  const d = DEFAULT_CHAT_DEADLINES;
  const toolFromEnv = positiveInt(env.CHAT_TOOL_TIMEOUT_MS);
  return {
    plannerMs: positiveInt(env.CHAT_PLANNER_TIMEOUT_MS) ?? d.plannerMs,
    toolMs: toolFromEnv ?? d.toolMs,
    toolRoundBudgetMs: positiveInt(env.CHAT_TOOL_ROUND_BUDGET_MS) ?? d.toolRoundBudgetMs,
    answerConnectMs: positiveInt(env.CHAT_ANSWER_CONNECT_TIMEOUT_MS) ?? d.answerConnectMs,
    answerIdleMs: positiveInt(env.CHAT_ANSWER_IDLE_TIMEOUT_MS) ?? d.answerIdleMs,
    // Never above the platform limit, whatever the environment says.
    turnMs: Math.min(positiveInt(env.CHAT_TURN_DEADLINE_MS) ?? d.turnMs, d.turnMs),
    toolMsFromEnv: toolFromEnv != null,
  };
}

/** How long one call to `name` may run. */
export function toolTimeoutMs(name: string, d: ChatDeadlines): number {
  if (d.toolMsFromEnv) return d.toolMs;
  return TOOL_TIMEOUT_OVERRIDES_MS[name] ?? d.toolMs;
}

export class ChatTimeoutError extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'ChatTimeoutError';
  }
}

/**
 * Resolve with `p`, or reject with ChatTimeoutError after `ms`. The timer is always cleared. A late
 * rejection of `p` is swallowed (the caller has already moved on), so it can never surface as an
 * unhandled rejection.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new ChatTimeoutError(label, ms)), Math.max(0, ms)); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/** One read from a stream reader, or 'timeout' if no bytes arrive within `ms`. */
export async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>, ms: number,
): Promise<ReadableStreamReadResult<T> | 'timeout'> {
  try {
    return await withTimeout(reader.read(), ms, 'answer_stream_idle');
  } catch (e) {
    if (e instanceof ChatTimeoutError) return 'timeout';
    throw e;
  }
}

/** The status fields of one executed (or refused) tool call. */
export interface ToolOutcome { status: string; error_category?: string | null }

/**
 * The customer notice for a tool round in which any lookup did not succeed (A6). Before, only
 * `failed` was announced; a policy refusal, an invalid-arguments refusal, a round-budget refusal or a
 * preflight rejection left the answer looking complete. Returns null when every call succeeded.
 *   lookup_failed     — a lookup ran and failed or timed out (the existing code and wording)
 *   lookup_incomplete — a lookup was refused before it ran
 */
export function incompleteToolNotice(outcomes: ReadonlyArray<ToolOutcome>): { code: string; message: string } | null {
  const bad = outcomes.filter((o) => o.status !== 'success');
  if (!bad.length) return null;
  if (bad.some((o) => o.status === 'failed')) {
    return { code: 'lookup_failed', message: 'One of the data lookups failed, so this answer may be incomplete.' };
  }
  return { code: 'lookup_incomplete', message: 'One of the data lookups could not be run, so this answer may be incomplete.' };
}
