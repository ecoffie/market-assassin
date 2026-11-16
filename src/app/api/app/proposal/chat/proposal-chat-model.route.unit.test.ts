/**
 * Proposal chat model isolation (2026-11-15).
 *
 * The real /api/app/proposal/chat handler, with auth, data and providers mocked. Pins:
 *  - Ask Mindy's B2 step-2 env (CHAT_OPENAI_MODEL=gpt-6.1-terra, CHAT_ANSWER_FALLBACKS=openai:gpt-6-luna)
 *    does NOT move proposal chat: it still requests gpt-4o, with the same raw params as before;
 *  - PROPOSAL_CHAT_OPENAI_MODEL overrides the proposal chat model when set;
 *  - an over-budget user still skips OpenAI and goes to Groq (unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = 'pro@example.com';
const budget = { over: false };
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: (_r: unknown, email: string) => ({ ok: true, session: { email } }),
}));
vi.mock('@/lib/access/require-pro', () => ({ isProEmail: async () => true, proRequiredResponse: () => new Response(null, { status: 402 }) }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: async () => ({ text: '' }) }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => budget.over, recordLlmUsage: async () => {} }));
vi.mock('@/lib/proposal/loaders', () => ({
  loadBidderProfile: async () => null,
  formatProfileForPrompt: () => '',
  loadVaultContext: async () => ({ has_any: false }),
  ALL_VAULT_SECTIONS: ['identity', 'past_performance', 'capabilities', 'team'],
}));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: async () => [], formatChunksForPrompt: () => '' }));
vi.mock('@/lib/proposal/select-relevant', () => ({ selectRelevantRfp: () => '' }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

function sse(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`));
    c.close();
  } });
}

beforeEach(() => {
  calls.length = 0;
  budget.over = false;
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubEnv('CHAT_OPENAI_MODEL', '');
  vi.stubEnv('CHAT_ANSWER_FALLBACKS', '');
  vi.stubEnv('PROPOSAL_CHAT_OPENAI_MODEL', '');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(sse('Drafted.'), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function ask() {
  vi.resetModules();
  const { POST } = await import('./route');
  const res = await POST(new Request('https://getmindy.ai/api/app/proposal/chat', {
    method: 'POST', body: JSON.stringify({ email: ME, message: 'Draft the technical approach' }),
  }) as never);
  return res.text();
}

const openaiCalls = () => calls.filter((c) => c.url === 'https://api.openai.com/v1/chat/completions');

describe('proposal chat model isolation', () => {
  it('with the B2 step-2 env set, proposal chat still requests gpt-4o with its unchanged raw params', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra');
    vi.stubEnv('CHAT_ANSWER_FALLBACKS', 'openai:gpt-6-luna');
    const raw = await ask();
    expect(openaiCalls()).toHaveLength(1);
    const body = openaiCalls()[0].body;
    expect(body.model).toBe('gpt-4o');
    // Request params byte-identical to before: raw temperature + max_tokens, streaming with usage.
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(4000);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(JSON.stringify(calls)).not.toMatch(/gpt-6/);
    expect(raw).toContain('Drafted.');
  });

  it('defaults to gpt-4o when nothing is set', async () => {
    await ask();
    expect(openaiCalls().map((c) => c.body.model)).toEqual(['gpt-4o']);
  });

  it('PROPOSAL_CHAT_OPENAI_MODEL overrides the proposal chat model, and CHAT_OPENAI_MODEL still has no effect', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra');
    vi.stubEnv('PROPOSAL_CHAT_OPENAI_MODEL', 'gpt-4o-mini');
    await ask();
    expect(openaiCalls().map((c) => c.body.model)).toEqual(['gpt-4o-mini']);
  });

  it('an over-budget user still skips OpenAI and goes to Groq (unchanged)', async () => {
    budget.over = true;
    vi.stubEnv('PROPOSAL_CHAT_OPENAI_MODEL', 'gpt-4o-mini');
    await ask();
    expect(openaiCalls()).toHaveLength(0);
    expect(calls.map((c) => c.url)).toEqual(['https://api.groq.com/openai/v1/chat/completions']);
  });
});
