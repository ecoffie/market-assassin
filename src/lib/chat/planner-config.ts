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
