/**
 * Preview-only model configuration selector for the B2 staging acceptance run.
 *
 * Lets one preview build compare model configurations per request (no rebuild, no env change)
 * through the `x-ask-mindy-staging-config` header. It is honored ONLY when the route's
 * TRACE_EVENTS gate is on, and that gate is false on production by construction
 * (`ASK_MINDY_TRACE_EVENTS === 'true' && VERCEL_ENV !== 'production'`). Only the named
 * configurations below can be selected; any other value is ignored.
 *
 * `answerPrimary` deliberately names a model that does not exist, so the provider returns a
 * real error and the route's REAL fallback path is exercised end to end.
 */
export const STAGING_CONFIG_HEADER = 'x-ask-mindy-staging-config';
export const FORCED_FAILURE_MODEL = 'mindy-staging-forced-failure';

export interface StagingModelConfig {
  /** Env overlay read by resolvePlannerChain / resolveAnswerChain. */
  env: Record<string, string>;
  /** Override for the answer chain's first model (planner is unaffected). */
  answerPrimary?: string;
  /** Treat the request as an over-budget user's (planner + answer = LLM_OPENAI_MODEL || gpt-4o-mini). */
  overBudget?: boolean;
}

export const STAGING_MODEL_CONFIGS: Readonly<Record<string, StagingModelConfig>> = {
  // Current production model selection (gpt-4o planner + answer), with this branch's default fallback.
  current: { env: {} },
  // Proposed long-term primary with both fallbacks configured.
  terra: { env: { CHAT_OPENAI_MODEL: 'gpt-6.1-terra', CHAT_ANSWER_FALLBACKS: 'openai:gpt-6-luna,groq:openai/gpt-oss-120b' } },
  // Same-provider fallback: the answer primary fails for real, gpt-6-luna must answer.
  'fallback-luna': { env: { CHAT_OPENAI_MODEL: 'gpt-6.1-terra', CHAT_ANSWER_FALLBACKS: 'openai:gpt-6-luna' }, answerPrimary: FORCED_FAILURE_MODEL },
  // Interim code-default fallback (what #2053 ships with no env change): current primary, the answer
  // primary fails for real, gpt-4o-mini must answer.
  'fallback-mini': { env: { CHAT_ANSWER_FALLBACKS: 'openai:gpt-4o-mini' }, answerPrimary: FORCED_FAILURE_MODEL },
  // The proposed release config as an OVER-BUDGET user sees it: planner and answer primary fall to
  // LLM_OPENAI_MODEL || gpt-4o-mini (unchanged by this release), answer fallback gpt-6-luna.
  'over-budget-terra': { env: { CHAT_OPENAI_MODEL: 'gpt-6.1-terra', CHAT_ANSWER_FALLBACKS: 'openai:gpt-6-luna' }, overBudget: true },
  // Independent-provider fallback: the answer primary fails for real, Groq gpt-oss-120b must answer.
  'fallback-groq': { env: { CHAT_OPENAI_MODEL: 'gpt-6.1-terra', CHAT_ANSWER_FALLBACKS: 'groq:openai/gpt-oss-120b' }, answerPrimary: FORCED_FAILURE_MODEL },
};

export function stagingModelConfig(headerValue: string | null, traceEnabled: boolean): { name: string; config: StagingModelConfig } | null {
  if (!traceEnabled || !headerValue) return null;
  const name = headerValue.trim();
  const config = Object.prototype.hasOwnProperty.call(STAGING_MODEL_CONFIGS, name) ? STAGING_MODEL_CONFIGS[name] : undefined;
  return config ? { name, config } : null;
}
