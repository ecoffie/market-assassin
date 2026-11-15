/**
 * Whole-request token budget for Ask Mindy (B2).
 *
 * The 60K-character evidence cap (bound-tool-result.ts) limits tool results only. This module
 * checks the WHOLE request — system instructions, conversation history, the verified record
 * list, tool calls and tool results, the tool catalog (planner round) — plus the response
 * headroom, against the model's context window and a cost policy cap, BEFORE the provider is
 * called. A request that cannot be fit is never sent; the customer gets a fixed message.
 *
 * Estimation is deliberately conservative: 3 characters per token (federal JSON — ids, codes,
 * dollar amounts — tokenizes denser than prose's ~4) plus per-message overhead. Over-estimating
 * costs a little context; under-estimating is the overflow this exists to prevent.
 *
 * Shrink order (each step only if still over): drop the oldest history → re-bound tool results
 * from their FULL originals at smaller caps (structural, still shown-of-total) → shorten the
 * verified record list copy given to the model (the customer already has the full list on screen).
 */
import { boundToolResult } from './bound-tool-result';

export const CHARS_PER_TOKEN = 3;
export const MESSAGE_OVERHEAD_TOKENS = 6;
export const SAFETY_MARGIN_TOKENS = 2_000;
/** Cost policy: never send more than this many input tokens, whatever the model allows. */
export const INPUT_POLICY_CAP_TOKENS = 100_000;
const MIN_TOOL_CAP_CHARS = 2_000;
const RECORDS_COPY_CHARS = 8_000;

const CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/^gpt-6/i, 1_050_000],
  [/^gpt-4o/i, 128_000],
  [/^gpt-4\.1/i, 1_047_576],
  [/^llama-|^openai\/gpt-oss/i, 128_000],
];
/** Unknown models get the smallest window we use, never a guess upward. */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

export function contextWindow(model: string): number {
  for (const [re, n] of CONTEXT_WINDOWS) if (re.test(model)) return n;
  return DEFAULT_CONTEXT_TOKENS;
}

/** Max input tokens for one request to `model` reserving `responseTokens` of output. */
export function inputBudget(model: string, responseTokens: number, policyCap = INPUT_POLICY_CAP_TOKENS): number {
  return Math.max(0, Math.min(contextWindow(model) - responseTokens - SAFETY_MARGIN_TOKENS, policyCap));
}

export function estimateTokens(text: string): number {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

type Msg = { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string };

export function estimateRequestTokens(messages: Msg[], tools?: unknown): number {
  let n = tools ? estimateTokens(JSON.stringify(tools)) : 0;
  for (const m of messages) {
    n += MESSAGE_OVERHEAD_TOKENS + estimateTokens(m.content ?? '');
    if (m.tool_calls) n += estimateTokens(JSON.stringify(m.tool_calls));
  }
  return n;
}

export type MsgKind = 'system' | 'history' | 'user' | 'tool_call' | 'tool' | 'records' | 'note';

export interface FitResult<M extends Msg> {
  messages: M[];
  fits: boolean;
  estimate: number;
  budget: number;
  droppedHistory: number;
  toolCapChars: number | null;
  recordsShortened: boolean;
}

/**
 * Fit `messages` (with a parallel `kinds` array) into `budget` input tokens.
 * `toolOriginals` maps a tool message's tool_call_id to its FULL result, so re-bounding always
 * starts from the original evidence, never from an already-shortened copy.
 */
export function fitMessages<M extends Msg>(
  input: M[], kinds: MsgKind[],
  opts: { budget: number; tools?: unknown; toolOriginals?: Map<string, string>; startToolCapChars?: number },
): FitResult<M> {
  let msgs = input.map((m) => ({ ...m }));
  let ks = [...kinds];
  const est = () => estimateRequestTokens(msgs, opts.tools);
  const res = (fits: boolean, extra: Partial<FitResult<M>> = {}): FitResult<M> => ({
    messages: msgs, fits, estimate: est(), budget: opts.budget,
    droppedHistory: 0, toolCapChars: null, recordsShortened: false, ...extra,
  });
  let dropped = 0;
  if (est() <= opts.budget) return res(true);

  // 1) Oldest history first.
  while (est() > opts.budget) {
    const i = ks.indexOf('history');
    if (i < 0) break;
    msgs.splice(i, 1); ks.splice(i, 1); dropped++;
  }
  if (est() <= opts.budget) return res(true, { droppedHistory: dropped });

  // 2) Re-bound tool results from their originals at halving caps.
  let cap = opts.startToolCapChars ?? 60_000;
  const toolIdx = ks.map((k, i) => (k === 'tool' ? i : -1)).filter((i) => i >= 0);
  let usedCap: number | null = null;
  while (est() > opts.budget && toolIdx.length && cap > MIN_TOOL_CAP_CHARS) {
    cap = Math.max(MIN_TOOL_CAP_CHARS, Math.floor(cap / 2));
    usedCap = cap;
    const per = Math.max(MIN_TOOL_CAP_CHARS, Math.floor(cap / toolIdx.length));
    msgs = msgs.map((m, i) => {
      if (ks[i] !== 'tool') return m;
      const orig = (m.tool_call_id && opts.toolOriginals?.get(m.tool_call_id)) ?? String(m.content ?? '');
      return { ...m, content: boundToolResult(orig, per).content };
    });
  }
  if (est() <= opts.budget) return res(true, { droppedHistory: dropped, toolCapChars: usedCap });

  // 3) The model's copy of the verified record list (the customer's copy is untouched).
  let shortened = false;
  msgs = msgs.map((m, i) => {
    if (ks[i] !== 'records' || String(m.content ?? '').length <= RECORDS_COPY_CHARS) return m;
    shortened = true;
    const c = String(m.content);
    return { ...m, content: `${c.slice(0, RECORDS_COPY_CHARS)}\n[Record list shortened for length. The full list is already on the customer's screen; do not refer to records not shown here.]` };
  });
  ks = [...ks];
  return res(est() <= opts.budget, { droppedHistory: dropped, toolCapChars: usedCap, recordsShortened: shortened });
}
