/**
 * Provider-agnostic LLM call with FALLBACK CHAIN (Eric: Groq's paid tier is
 * closed "due to high demand", so we can't be hostage to one provider). Tries
 * providers in order; on rate-limit / too-large / unavailable, falls through to
 * the next. Combined with the shared compliance cache, this keeps proposals
 * working at scale regardless of any single provider's capacity.
 *
 * Chain is env-configurable (LLM_CHAIN). Each provider is only attempted if its
 * key is set — so it works today with whatever's funded and slots in Claude/etc
 * the moment they're funded, no code change.
 *
 * Use: const text = await callLLM({ system, user, json: true, maxTokens });
 */
import { recordLlmUsage } from './usage-cost';

// Per-JOB chains (Eric: Claude's limits hit fast + it's pricey — use it ONLY for
// low-volume high-value calls, NEVER bulk extraction). The job determines which
// providers are eligible, so Claude is simply absent from the high-volume path.
export type LlmJob = 'extraction' | 'drafting' | 'referee' | 'reasoning';

export interface LlmOpts {
  system: string;
  user: string;
  json?: boolean;        // request JSON object output
  maxTokens?: number;
  temperature?: number;
  job?: LlmJob;          // picks the per-job provider chain (default 'extraction')
  // Optional per-call model override for the OpenAI-compatible providers
  // (openai/groq70b/groq8b/grok). Lets a specific high-value call opt UP to a
  // stronger model (e.g. gpt-4o) without changing the global default for every
  // other call. Ignored for Claude (which has its own model env) and for any
  // provider it doesn't apply to. Only honored for the 'openai' provider unless
  // it looks like that provider's model family.
  openaiModel?: string;
  // Data Trust Phase 3.1 — data classification. When 'sensitive', the call
  // carries customer vault PII (identity, past performance, resumes, uploaded
  // docs), so the provider chain is RESTRICTED to the vetted no-training
  // allow-list (SENSITIVE_PROVIDERS) — never the ad-hoc fallback that could send
  // PII to whichever provider answers first. This is what lets us tell a customer
  // exactly which providers ever see their data. Default 'standard' = today's
  // behavior (non-PII: SAM notices, agency data, public RFP text).
  dataClass?: 'standard' | 'sensitive';
  // Cost attribution (usage-cost.ts). Optional — when set, every successful call
  // is logged to llm_usage_log with its real token cost so per-user / per-tool
  // spend becomes MEASURED, not estimated. `tool` = the feature (e.g. 'chat',
  // 'proposal_draft', 'briefing'); `userEmail` = who to bill it to (null for
  // system/cron work). Logging is fire-and-forget and never affects the call.
  tool?: string;
  userEmail?: string | null;
}

type Provider = 'groq70b' | 'groq8b' | 'claude' | 'openai' | 'grok';

// EXTRACTION = high volume (every doc, chunked) → cheap/fast only, NO Claude.
//   The cache absorbs most of these anyway.
// DRAFTING   = low volume (user-triggered) → Groq quality, Claude as fallback.
// REFEREE    = once per proposal, must differ from drafter → Claude first.
const JOB_CHAINS: Record<LlmJob, Provider[]> = {
  extraction: ['groq8b', 'groq70b', 'openai', 'grok'],   // no Claude — bulk
  // Drafting leads with Claude for QUALITY (Eric QC: Groq wrote "Agile sprints"
  // for a construction job). Low volume — user-triggered per section — so
  // Claude's limits are fine; Groq 70B is the fast fallback.
  drafting:   ['claude', 'groq70b', 'openai', 'grok'],
  referee:    ['claude', 'openai', 'groq70b'],            // Claude OK — 1x/proposal
  // REASONING = user-facing RFP extraction/judgment (chat, bid-gates) where Groq
  // is too weak BUT Claude isn't scalable at $149/mo (Eric: a user could run a
  // $200 Claude bill). GPT-4o-mini is near-Claude quality at ~20-40x lower cost →
  // the default. Groq is the cheap fallback; Claude is a last resort only.
  reasoning:  ['openai', 'groq70b', 'claude'],
};
const DEFAULT_CHAIN: Provider[] = JOB_CHAINS.extraction;

// Data Trust Phase 3.1 — providers vetted as NO-TRAINING-on-API-data, allowed to
// receive customer vault PII. OpenAI + Anthropic API tiers contractually don't
// train on API inputs; Groq is inference-only. xAI/Grok is EXCLUDED (training
// policy is not clearly a no-train guarantee) — we'd rather be conservative with
// PII than send it somewhere we can't cleanly promise a customer about.
// Env-overridable (SENSITIVE_LLM_PROVIDERS) so the allow-list can tighten to a
// single provider (e.g. just 'openai') for a customer who wants one named vendor.
const DEFAULT_SENSITIVE_PROVIDERS: Provider[] = ['openai', 'claude', 'groq70b', 'groq8b'];

function sensitiveProviders(): Provider[] {
  const raw = process.env.SENSITIVE_LLM_PROVIDERS;
  if (!raw) return DEFAULT_SENSITIVE_PROVIDERS;
  return raw.split(',').map(s => s.trim()).filter(Boolean) as Provider[];
}

function envChain(): Provider[] | null {
  const raw = process.env.LLM_CHAIN;
  if (!raw) return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean) as Provider[];
}

// Is a provider usable (key present)? We skip ones with no key so the chain
// adapts to whatever is funded.
function hasKey(p: Provider): boolean {
  switch (p) {
    case 'groq70b':
    case 'groq8b': return !!process.env.GROQ_API_KEY;
    case 'claude': return !!process.env.ANTHROPIC_API_KEY;
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'grok': return !!process.env.GROK_API_KEY;
  }
}

interface TokenUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
interface CallResult { text: string; provider: Provider; model?: string; usage?: TokenUsage }

async function callProvider(p: Provider, opts: LlmOpts): Promise<CallResult | { retry: true } | null> {
  const max = opts.maxTokens ?? 2000;
  const temp = opts.temperature ?? 0.3;
  try {
    if (p === 'claude') {
      const model = process.env.LLM_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
      // New-generation Claude (Sonnet 5 / Opus 4.7+ / Fable 5) REJECTS any
      // non-default temperature/top_p/top_k with a 400. Older models (Haiku 4.5,
      // Sonnet/Opus 4.x) still accept temperature. So only send `temperature` on
      // models that allow it — otherwise a Sonnet-5 upgrade would 400 on every
      // draft and silently fall through to Groq (the opposite of the upgrade).
      const acceptsTemperature = /haiku-4-5|sonnet-4-|opus-4-[0-5]|claude-3/i.test(model);
      const body: Record<string, unknown> = {
        model, max_tokens: max, system: opts.system,
        messages: [{ role: 'user', content: opts.json ? `${opts.user}\n\nRespond with ONLY valid JSON.` : opts.user }],
      };
      if (acceptsTemperature) body.temperature = temp;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 529 || res.status === 400) return { retry: true };
      if (!res.ok) return { retry: true };
      const j = await res.json();
      // Anthropic usage shape → normalize to {prompt,completion,total}.
      const u = j.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens, total_tokens: (j.usage.input_tokens || 0) + (j.usage.output_tokens || 0) } : undefined;
      return { text: j.content?.[0]?.text || '', provider: p, model, usage: u };
    }
    // OpenAI-compatible providers (Groq, OpenAI, Grok all share the schema).
    const cfg = {
      groq70b: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile' },
      groq8b: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant' },
      openai: { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY, model: opts.openaiModel || process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini' },
      grok: { url: 'https://api.x.ai/v1/chat/completions', key: process.env.GROK_API_KEY, model: process.env.LLM_GROK_MODEL || 'grok-3' },
    }[p]!;
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
        max_tokens: max, temperature: temp,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    // 429 rate-limit, 413/400 too-large/bad, 403 auth/quota → try next provider.
    if ([429, 413, 400, 403, 401, 503].includes(res.status)) return { retry: true };
    if (!res.ok) return { retry: true };
    const j = await res.json();
    return { text: j.choices?.[0]?.message?.content || '', provider: p, model: cfg.model, usage: j.usage };
  } catch {
    return { retry: true };
  }
}

/**
 * Call the LLM with automatic provider fallback. Returns the text + which
 * provider answered. Throws only if EVERY available provider failed.
 */
export async function callLLM(opts: LlmOpts): Promise<{ text: string; provider: Provider; model?: string; usage?: TokenUsage }> {
  // env LLM_CHAIN overrides everything; otherwise pick the per-job chain so
  // Claude is only eligible for drafting/referee, never bulk extraction.
  const jobChain = JOB_CHAINS[opts.job ?? 'extraction'] ?? DEFAULT_CHAIN;
  let chain = (envChain() || jobChain).filter(hasKey);

  // Data Trust Phase 3.1 — a sensitive (vault-PII) call may ONLY use the vetted
  // no-training allow-list, and IGNORES the LLM_CHAIN env override (which could
  // otherwise route PII to an un-vetted provider). We keep the per-job ordering
  // but drop any provider not on the allow-list. Result: customer PII is only
  // ever sent to providers we can name and promise about.
  if (opts.dataClass === 'sensitive') {
    const allow = new Set(sensitiveProviders());
    chain = (jobChain.filter(hasKey)).filter(p => allow.has(p));
    if (chain.length === 0) {
      throw new Error('No no-training LLM provider available for sensitive data');
    }
  }

  if (chain.length === 0) throw new Error('No LLM provider keys configured');
  let lastErr = '';
  for (const p of chain) {
    const r = await callProvider(p, opts);
    if (r && 'text' in r && r.text) {
      // Cost attribution — log the real token cost when a `tool` is provided.
      // Fire-and-forget: recordLlmUsage swallows its own errors and never blocks.
      if (opts.tool) {
        void recordLlmUsage({
          userEmail: opts.userEmail ?? null,
          tool: opts.tool,
          job: opts.job,
          provider: r.provider,
          model: r.model,
          usage: r.usage,
        });
      }
      return r;
    }
    lastErr = `${p} unavailable`;
  }
  throw new Error(`All LLM providers failed (${lastErr})`);
}
