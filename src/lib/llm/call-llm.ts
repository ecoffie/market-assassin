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

// Per-JOB chains (Eric: Claude's limits hit fast + it's pricey — use it ONLY for
// low-volume high-value calls, NEVER bulk extraction). The job determines which
// providers are eligible, so Claude is simply absent from the high-volume path.
export type LlmJob = 'extraction' | 'drafting' | 'referee';

export interface LlmOpts {
  system: string;
  user: string;
  json?: boolean;        // request JSON object output
  maxTokens?: number;
  temperature?: number;
  job?: LlmJob;          // picks the per-job provider chain (default 'extraction')
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
};
const DEFAULT_CHAIN: Provider[] = JOB_CHAINS.extraction;

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

interface CallResult { text: string; provider: Provider }

async function callProvider(p: Provider, opts: LlmOpts): Promise<CallResult | { retry: true } | null> {
  const max = opts.maxTokens ?? 2000;
  const temp = opts.temperature ?? 0.3;
  try {
    if (p === 'claude') {
      const model = process.env.LLM_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: max, temperature: temp, system: opts.system,
          messages: [{ role: 'user', content: opts.json ? `${opts.user}\n\nRespond with ONLY valid JSON.` : opts.user }],
        }),
      });
      if (res.status === 429 || res.status === 529 || res.status === 400) return { retry: true };
      if (!res.ok) return { retry: true };
      const j = await res.json();
      return { text: j.content?.[0]?.text || '', provider: p };
    }
    // OpenAI-compatible providers (Groq, OpenAI, Grok all share the schema).
    const cfg = {
      groq70b: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile' },
      groq8b: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant' },
      openai: { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY, model: process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini' },
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
    return { text: j.choices?.[0]?.message?.content || '', provider: p };
  } catch {
    return { retry: true };
  }
}

/**
 * Call the LLM with automatic provider fallback. Returns the text + which
 * provider answered. Throws only if EVERY available provider failed.
 */
export async function callLLM(opts: LlmOpts): Promise<{ text: string; provider: Provider }> {
  // env LLM_CHAIN overrides everything; otherwise pick the per-job chain so
  // Claude is only eligible for drafting/referee, never bulk extraction.
  const jobChain = JOB_CHAINS[opts.job ?? 'extraction'] ?? DEFAULT_CHAIN;
  const chain = (envChain() || jobChain).filter(hasKey);
  if (chain.length === 0) throw new Error('No LLM provider keys configured');
  let lastErr = '';
  for (const p of chain) {
    const r = await callProvider(p, opts);
    if (r && 'text' in r && r.text) return r;
    lastErr = `${p} unavailable`;
  }
  throw new Error(`All LLM providers failed (${lastErr})`);
}
