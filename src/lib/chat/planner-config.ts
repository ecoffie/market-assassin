/**
 * Ask Mindy planner (tool round) model selection — explicit, logged, and fallback-restricted.
 *
 * Approved 2026-11-13 (D2):
 *   - gpt-4o is the explicit default planner. (It was already the effective planner: the
 *     Claude-first path has failed on every turn since the Anthropic account lapsed on
 *     2026-09-26, and fell through silently.)
 *   - Claude runs only when CHAT_CLAUDE_ENABLED === 'true' (default off). Setting
 *     CHAT_CLAUDE_MODEL alone no longer triggers an Anthropic call.
 *   - A fallback planner is allowed only if it is in TOOL_COMPATIBLE_PLANNERS (models that
 *     have passed the tool-round compatibility tests). Default: no fallback. Groq Llama 8B
 *     was the old last resort; it has not passed those tests (the ~17K-token tool catalog
 *     alone strains it), so it is no longer used for the tool round.
 *   - Every planner failure and every fallback is recorded (tool_errors + ops alert).
 */
export type PlannerProvider = 'openai' | 'anthropic';

export interface PlannerTarget {
  provider: PlannerProvider;
  model: string;
}

/** provider:model pairs that have passed the tool-round compatibility tests. */
export const TOOL_COMPATIBLE_PLANNERS: ReadonlySet<string> = new Set([
  'openai:gpt-4o',
  'openai:gpt-4o-mini', // already the planner for users over their monthly LLM budget
  'anthropic:claude-sonnet-5', // served 230 production tool rounds through 2026-09-25
  // gpt-6-luna (OpenAI's named replacement for gpt-4o/gpt-4o-mini, which shut down 2027-01-14):
  // route test ask-mindy-b2 "luna planner" + live replay of the 8 acceptance planner requests
  // (56 real tools, auto and required tool_choice, reasoning_effort none) 24/24 accepted, 2026-11-15.
  'openai:gpt-6-luna',
]);

export const plannerKey = (t: PlannerTarget) => `${t.provider}:${t.model}`;

type Env = Record<string, string | undefined>;

function parseTargets(raw: string | undefined): PlannerTarget[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return i > 0 ? { provider: s.slice(0, i) as PlannerProvider, model: s.slice(i + 1) } : null;
    })
    .filter((t): t is PlannerTarget => !!t && (t.provider === 'openai' || t.provider === 'anthropic'));
}

/**
 * Ordered planner chain. The first entry is the planner; later entries are fallbacks,
 * each already filtered to the compatibility list and to providers with a configured key.
 */
export function resolvePlannerChain(env: Env, opts: { overBudget: boolean }): PlannerTarget[] {
  const openaiPrimary: PlannerTarget = {
    provider: 'openai',
    model: opts.overBudget ? env.LLM_OPENAI_MODEL || 'gpt-4o-mini' : env.CHAT_OPENAI_MODEL || 'gpt-4o',
  };
  const chain: PlannerTarget[] = [];
  const claudeEnabled = env.CHAT_CLAUDE_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY && !opts.overBudget;
  if (claudeEnabled) chain.push({ provider: 'anthropic', model: env.CHAT_CLAUDE_MODEL || 'claude-sonnet-5' });
  chain.push(openaiPrimary);
  for (const t of parseTargets(env.CHAT_PLANNER_FALLBACKS)) chain.push(t);

  const hasKey = (t: PlannerTarget) => (t.provider === 'openai' ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY);
  const seen = new Set<string>();
  return chain.filter((t, i) => {
    const k = plannerKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    if (!hasKey(t)) return false;
    // The configured primary is always kept; fallbacks must be compatibility-tested.
    return i === 0 || TOOL_COMPATIBLE_PLANNERS.has(k);
  });
}

/** Newer Claude models reject forced tool choice ({type:'any'}) with a 400. */
export function anthropicSupportsForcedToolChoice(model: string): boolean {
  return !/(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)/i.test(model);
}

/**
 * Answer-step (streaming, no tools) model chain — B2.
 *
 * The old answer fallback was Groq `llama-3.1-8b-instant`, chosen in May for quota reasons.
 * It is no longer a supported backup: it never passed the grounded-answer checks, and with
 * no key configured the route used to refuse EVERY chat turn up front, even when the primary
 * was healthy.
 *
 * Default chain: the configured OpenAI chat model, then `openai:gpt-4o-mini` — the model
 * already used for over-budget users, already on the private-data approved list, and already
 * compatibility-tested for the tool round. CHAT_ANSWER_FALLBACKS (comma list of
 * provider:model, providers openai|groq) replaces the default fallbacks when set; set it to
 * the literal 'none' for no fallback. Groq runs only when listed explicitly.
 */
export type AnswerProvider = 'openai' | 'groq';
export interface AnswerTarget { provider: AnswerProvider; model: string }

export const DEFAULT_ANSWER_FALLBACK: AnswerTarget = { provider: 'openai', model: 'gpt-4o-mini' };

export const ANSWER_ENDPOINTS: Record<AnswerProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

export function answerKey(env: Env, t: AnswerTarget): string | undefined {
  return t.provider === 'openai' ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
}

export function resolveAnswerChain(env: Env, opts: { primaryModel: string }): AnswerTarget[] {
  const raw = env.CHAT_ANSWER_FALLBACKS;
  const fallbacks: AnswerTarget[] = raw === 'none'
    ? []
    : raw
      ? raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const i = s.indexOf(':');
        return i > 0 ? { provider: s.slice(0, i) as AnswerProvider, model: s.slice(i + 1) } : null;
      }).filter((t): t is AnswerTarget => !!t && (t.provider === 'openai' || t.provider === 'groq') && !!t.model)
      : [DEFAULT_ANSWER_FALLBACK];
  const seen = new Set<string>();
  return [{ provider: 'openai' as const, model: opts.primaryModel }, ...fallbacks].filter((t) => {
    const k = `${t.provider}:${t.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return !!answerKey(env, t);
  });
}

/**
 * OpenAI Chat Completions parameters per model family (B2).
 *
 * gpt-4o / gpt-4o-mini (snapshots shut down Jan 14, 2027 per OpenAI's deprecations page) take
 * `temperature` + `max_tokens`. The GPT-5/GPT-6 reasoning families take `max_completion_tokens`,
 * and OpenAI documents that function calling on Chat Completions for gpt-6-luna works only with
 * `reasoning_effort: 'none'`. `temperature` is omitted for those families until a live
 * compatibility run proves it is accepted (an unsupported parameter is a 400, i.e. an outage).
 */
export function isReasoningFamily(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/i.test(model);
}

export function openAiChatParams(model: string, opts: { temperature: number; maxTokens: number }): Record<string, unknown> {
  if (isReasoningFamily(model)) return { max_completion_tokens: opts.maxTokens, reasoning_effort: 'none' };
  return { temperature: opts.temperature, max_tokens: opts.maxTokens };
}
