/**
 * B2 (Ask Mindy reliability) — the real /api/app/chat handler with providers and tools mocked.
 *
 * Pins, through the route:
 *  - provider error text never reaches the customer (answer failure, thrown stream error);
 *  - the supported fallback (openai:gpt-4o-mini) serves the answer when the primary fails, and the
 *    retired Groq 8B backup is not called;
 *  - a missing GROQ_API_KEY no longer refuses every turn;
 *  - an oversized tool result is bounded before the answer call, with a shown-of-total report;
 *  - an open-opportunity question is not offered get_expiring_contracts, and a planner call to it is dropped;
 *  - a failed search is reported as failed, never as an empty result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CUSTOMER_ERROR_MESSAGES } from '@/lib/chat/customer-errors';

const ME = 'pro@example.com';
const SECRET = 'context_length_exceeded req_9f2 model=gpt-4o sk-live-LEAK';

type ToolCall = { id: string; function: { name: string; arguments: string } };
const state: {
  plannerCalls: ToolCall[];
  offered: string[][];
  executed: string[][];
  executedArgs: Array<Record<string, unknown>>;
  toolContent: string;
  toolStatus: 'success' | 'failed';
  answerModels: string[];
  answerUrls: string[];
  failModels: Set<string>;
  answerThrows: boolean;
  answerMessages: Array<Array<{ role: string; content: string }>>;
  plannerModels: string[];
  extraOffered: string[];
  plannerBodies: Array<Record<string, unknown>>;
  plannerFailModels: Set<string>;
} = {} as never;
const budget = { over: false };

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
const profile = { block: '' };
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => profile.block }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => budget.over, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));
vi.mock('@/lib/chat/chat-tool-executor', () => ({
  createChatToolExecutor: () => ({
    offeredToolDefs: () => ['get_expiring_contracts', 'search_sam_opportunities', ...(state.extraOffered ?? [])].map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } })),
    executeRound: async (calls: ToolCall[]) => {
      state.executed.push(calls.map((c) => c.function.name));
      for (const c of calls) state.executedArgs.push({ tool: c.function.name, ...JSON.parse(c.function.arguments || '{}') });
      return calls.map((c) => ({
        tool_call_id: c.id,
        content: state.toolStatus === 'failed'
          ? JSON.stringify({ ok: false, state: 'unavailable', error_category: 'tool_error', message: 'This lookup failed, so its data is unavailable. Do not treat it as an empty result.' })
          : state.toolContent,
        argsRedacted: {},
        record: { tool: c.function.name, status: state.toolStatus, execution_id: 'x' },
      }));
    },
    policyFor: () => ({ decision: 'allowed_read' }),
  }),
}));

function builder() {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
  q.update = () => ({ eq: async () => ({ error: null }) });
  q.insert = async () => ({ error: null });
  q.maybeSingle = async () => ({ data: null, error: null });
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => builder() }) }));

function sse(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    c.close();
  } });
}

beforeEach(() => {
  Object.assign(state, {
    plannerCalls: [], offered: [], executed: [], executedArgs: [], toolContent: '{"ok":true,"results":[]}', toolStatus: 'success',
    answerModels: [], answerUrls: [], failModels: new Set(), answerThrows: false, answerMessages: [], plannerModels: [], plannerBodies: [], plannerFailModels: new Set(), extraOffered: [],
  });
  profile.block = '';
  budget.over = false;
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (!b.stream) {
      state.plannerModels.push(b.model);
      state.plannerBodies.push(b);
      if (state.plannerFailModels.has(b.model)) return new Response(`{"error":{"message":"${SECRET}"}}`, { status: 503 });
      state.offered.push((b.tools ?? []).map((t: { function?: { name?: string } }) => String(t.function?.name)));
      return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: state.plannerCalls.length ? state.plannerCalls : undefined } }] }), { status: 200 });
    }
    state.answerModels.push(b.model); state.answerUrls.push(url); state.answerMessages.push(b.messages);
    if (state.failModels.has(b.model)) return new Response(`{"error":{"message":"${SECRET}"}}`, { status: 500 });
    if (state.answerThrows) {
      return new Response(new ReadableStream({ start(c) { c.error(new Error(SECRET)); } }), { status: 200 });
    }
    return new Response(sse('Review the records above.'), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ask(message: string) {
  vi.resetModules();
  const { POST } = await import('./route');
  const res = await POST(new Request('https://getmindy.ai/api/app/chat', { method: 'POST', body: JSON.stringify({ email: ME, message }) }) as never);
  const raw = await res.text();
  const events = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, raw, events };
}

describe('B2: customer-safe errors', () => {
  it('every answer model failing shows the fixed message and no provider text', async () => {
    state.failModels = new Set(['gpt-4o', 'gpt-4o-mini']);
    const { raw, events } = await ask('How do I write a capability statement?');
    const err = events.find((e) => e.type === 'error');
    expect(err?.message).toBe(CUSTOMER_ERROR_MESSAGES.find((m) => m.startsWith("Mindy couldn't answer")));
    expect(raw).not.toMatch(/context_length|req_9f2|sk-live|AI 500|gpt-4o/);
  });

  it('an exception while streaming shows the fixed message and not the exception text', async () => {
    state.answerThrows = true;
    const { raw, events } = await ask('How do I write a capability statement?');
    expect(events.find((e) => e.type === 'error')?.code).toBe('stream_failed');
    expect(raw).not.toMatch(/context_length|req_9f2|sk-live/);
  });
});

describe('B2: supported fallback model', () => {
  it('primary failure falls back to openai:gpt-4o-mini; the retired Groq 8B backup is never called', async () => {
    state.failModels = new Set(['gpt-4o']);
    const { events } = await ask('How do I write a capability statement?');
    expect(state.answerModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(state.answerUrls.every((u) => u.startsWith('https://api.openai.com/'))).toBe(true);
    expect(events.some((e) => e.type === 'token' && /Review the records/.test(e.content))).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('a missing GROQ_API_KEY no longer refuses the turn', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const { status, events } = await ask('How do I write a capability statement?');
    expect(status).toBe(200);
    expect(events.some((e) => e.type === 'token')).toBe(true);
  });
});

describe('B2: tool selection and bounded results', () => {
  const OPP_Q = 'What janitorial opportunities are open in Florida right now?';

  it('an open-opportunity question is not offered get_expiring_contracts; a planner call to it is dropped', async () => {
    state.plannerCalls = [
      { id: 'c1', function: { name: 'get_expiring_contracts', arguments: '{"naics":"561720"}' } },
      { id: 'c2', function: { name: 'search_sam_opportunities', arguments: '{"query":"janitorial","state":"FL"}' } },
    ];
    await ask(OPP_Q);
    expect(state.offered[0]).toEqual(['search_sam_opportunities']);
    expect(state.executed).toEqual([['search_sam_opportunities']]);
  });

  it('a recompete question keeps get_expiring_contracts', async () => {
    await ask('Which janitorial contracts in Florida are expiring or up for recompete?');
    expect(state.offered[0]).toContain('get_expiring_contracts');
  });

  it('an oversized tool result is bounded before the answer call and reports shown-of-total', async () => {
    const results = Array.from({ length: 400 }, (_, i) => ({
      notice_id: `N${i}`, title: `Janitorial services ${i}`, description: 'x'.repeat(3000),
    }));
    state.toolContent = JSON.stringify({ ok: true, results, _meta: { grounded: true, source: 'sam_opportunities' } });
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{"query":"janitorial"}' } }];
    await ask(OPP_Q);
    const toolMsg = state.answerMessages[0].find((m) => m.role === 'tool')!;
    expect(state.toolContent.length).toBeGreaterThan(1_000_000);
    expect(toolMsg.content.length).toBeLessThanOrEqual(60_000);
    const parsed = JSON.parse(toolMsg.content);
    expect(parsed._meta).toEqual({ grounded: true, source: 'sam_opportunities' });
    expect(parsed._truncation.lists).toEqual([{ path: 'results', shown: parsed.results.length, total: 400 }]);
    expect(parsed.results[0].notice_id).toBe('N0');
  });

  it('a failed search is reported as a failed lookup, never as an empty result', async () => {
    state.toolStatus = 'failed';
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{"query":"janitorial"}' } }];
    const { events } = await ask(OPP_Q);
    expect(events.some((e) => e.type === 'notice' && e.code === 'lookup_failed')).toBe(true);
    const toolMsg = state.answerMessages[0].find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toMatch(/Do not treat it as an empty result/);
  });
});

describe('B2: whole-request token budget', () => {
  it('an over-budget request is never sent to any model; the customer gets the fixed too-large message', async () => {
    profile.block = 'p'.repeat(400_000); // ~133K estimated tokens of instructions: over the 100K policy cap
    const { events, raw } = await ask('How do I write a capability statement?');
    expect(state.answerModels).toEqual([]); // no answer call was made
    expect(state.offered).toEqual([]);      // no planner call was made either
    expect(events.find((e) => e.type === 'error')?.code).toBe('request_too_large');
    expect(raw).not.toMatch(/est \d+|budget \d+|tokens/);
  });

  it('a large but fittable request is sent within budget', async () => {
    const results = Array.from({ length: 2000 }, (_, i) => ({ notice_id: `N${i}`, title: `T${i}`, description: 'x'.repeat(1500) }));
    state.toolContent = JSON.stringify({ ok: true, results });
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{"query":"janitorial"}' } }];
    await ask('What janitorial opportunities are open in Florida right now?');
    expect(state.answerModels).toEqual(['gpt-4o']);
    expect(JSON.stringify(state.answerMessages[0]).length / 3).toBeLessThan(100_000);
  });

  it('a GPT-6 primary is called with reasoning_effort none and max_completion_tokens', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra');
    const bodies: Array<Record<string, unknown>> = [];
    const orig = globalThis.fetch as unknown as (u: string, i: { body: string }) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return orig(u, init); }));
    await ask('How do I write a capability statement?');
    for (const b of bodies.filter((x) => x.model === 'gpt-6.1-terra')) {
      expect(b).toMatchObject({ reasoning_effort: 'none' });
      expect(b).not.toHaveProperty('temperature');
      expect(b).not.toHaveProperty('max_tokens');
    }
    expect(bodies.some((b) => b.model === 'gpt-6.1-terra')).toBe(true);
  });

  it('Ask Mindy honours CHAT_OPENAI_MODEL (step-2 env): plans and answers on terra, luna answers on failure; PROPOSAL_CHAT_OPENAI_MODEL has no effect', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra'); vi.stubEnv('CHAT_ANSWER_FALLBACKS', 'openai:gpt-6-luna');
    vi.stubEnv('PROPOSAL_CHAT_OPENAI_MODEL', 'gpt-4o-mini');
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{}' } }];
    await ask('What janitorial opportunities are open in Florida right now?');
    expect(state.plannerModels).toEqual(['gpt-6.1-terra']);
    expect(state.answerModels).toEqual(['gpt-6.1-terra']);
    state.answerModels = []; state.plannerModels = [];
    state.failModels = new Set(['gpt-6.1-terra']);
    await ask('What janitorial opportunities are open in Florida right now?');
    expect(state.answerModels).toEqual(['gpt-6.1-terra', 'gpt-6-luna']);
  });
});

describe('B2: over-budget users (LLM_OPENAI_MODEL || gpt-4o-mini, unchanged by this release)', () => {
  it('with the proposed release env, an over-budget user plans and answers on gpt-4o-mini; luna is the answer fallback', async () => {
    budget.over = true;
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra'); vi.stubEnv('CHAT_ANSWER_FALLBACKS', 'openai:gpt-6-luna');
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{}' } }];
    await ask('What janitorial opportunities are open in Florida right now?');
    expect(state.plannerModels).toEqual(['gpt-4o-mini']);
    expect(state.answerModels).toEqual(['gpt-4o-mini']);
    state.answerModels = []; state.plannerModels = [];
    state.failModels = new Set(['gpt-4o-mini']);
    await ask('What janitorial opportunities are open in Florida right now?');
    expect(state.answerModels).toEqual(['gpt-4o-mini', 'gpt-6-luna']);
  });

  it('Incident A guard: an over-budget user with a huge tool result never sends gpt-4o-mini more than its 128K window', async () => {
    budget.over = true;
    const results = Array.from({ length: 3000 }, (_, i) => ({ notice_id: `N${i}`, title: `T${i}`, description: 'x'.repeat(1500) }));
    state.toolContent = JSON.stringify({ ok: true, results }); // ~4.6M chars, far past 128K tokens
    state.plannerCalls = [{ id: 'c1', function: { name: 'get_expiring_contracts', arguments: '{}' } }];
    await ask('Which janitorial contracts are expiring in the next 24 months?');
    expect(state.answerModels[0]).toBe('gpt-4o-mini');
    for (const msgs of state.answerMessages) {
      // 3 chars/token is the guard's conservative estimate; real tokenization is ≥ 3.5 chars/token for this text.
      expect(JSON.stringify(msgs).length / 3).toBeLessThan(100_000);
    }
    // The Incident A shape: a fixed part the per-result bound cannot shrink pushes the whole request past
    // the window. The whole-request guard must refuse to send it (not let gpt-4o-mini 400 on it).
    state.answerModels = [];
    profile.block = 'p'.repeat(330_000); // ≈110K estimated tokens on its own
    const { events } = await ask('Which janitorial contracts are expiring in the next 24 months?');
    expect(state.answerModels).toEqual([]);
    expect(events.find((e) => e.type === 'error')?.code).toBe('request_too_large');
  });

  it('the preview-only over-budget-terra config reproduces that path on a traced preview, and is ignored on production', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'preview');
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: '{}' } }];
    const mk = () => new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'over-budget-terra' }, body: JSON.stringify({ email: ME, message: 'What janitorial opportunities are open in Florida right now?' }) });
    vi.resetModules();
    await (await (await import('./route')).POST(mk() as never)).text();
    expect(state.plannerModels).toEqual(['gpt-4o-mini']);
    expect(state.answerModels).toEqual(['gpt-4o-mini']);
    state.plannerModels = []; state.answerModels = [];
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.resetModules();
    await (await (await import('./route')).POST(mk() as never)).text();
    expect(state.plannerModels).toEqual(['gpt-4o']); // header ignored: real (not over-budget) default
  });
});

describe('B2: staging usage trace', () => {
  it('trace_usage is emitted on preview with the flag, and never on production even with the flag', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await ask('How do I write a capability statement?')).events.some((e) => e.type === 'trace_usage')).toBe(true);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await ask('How do I write a capability statement?')).events.some((e) => e.type === 'trace_usage')).toBe(false);
  });
});

describe('B2: preview-only staging model selector', () => {
  it('is ignored without the trace gate (and therefore always on production)', async () => {
    vi.resetModules();
    const { POST } = await import('./route');
    const mk = () => new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'fallback-groq' }, body: JSON.stringify({ email: ME, message: 'How do I write a capability statement?' }) });
    await (await POST(mk() as never)).text();
    expect(state.answerModels).toEqual(['gpt-4o']); // default config, header ignored
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'production');
    state.answerModels = [];
    vi.resetModules();
    await (await (await import('./route')).POST(mk() as never)).text();
    expect(state.answerModels).toEqual(['gpt-4o']);
  });

  it('on a traced preview, fallback-groq forces a real primary failure and Groq answers', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'preview');
    state.failModels = new Set(['mindy-staging-forced-failure']);
    vi.resetModules();
    const { POST } = await import('./route');
    const res = await POST(new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'fallback-groq' }, body: JSON.stringify({ email: ME, message: 'How do I write a capability statement?' }) }) as never);
    const raw = await res.text();
    expect(state.answerModels).toEqual(['mindy-staging-forced-failure', 'openai/gpt-oss-120b']);
    expect(state.answerUrls[1]).toMatch(/^https:\/\/api\.groq\.com\//);
    expect(raw).toMatch(/"fallback":true/);
  });

  it('on a traced preview, fallback-mini forces a real primary failure and gpt-4o-mini answers (current planner)', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'preview');
    state.failModels = new Set(['mindy-staging-forced-failure']);
    vi.resetModules();
    const { POST } = await import('./route');
    const res = await POST(new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'fallback-mini' }, body: JSON.stringify({ email: ME, message: 'How do I write a capability statement?' }) }) as never);
    const raw = await res.text();
    expect(state.answerModels).toEqual(['mindy-staging-forced-failure', 'gpt-4o-mini']);
    expect(state.answerUrls[1]).toMatch(/^https:\/\/api\.openai\.com\//);
    expect(raw).toMatch(/"fallback":true/);
    expect(raw).toMatch(/"answer_attempts":\[\{"provider":"openai","model":"mindy-staging-forced-failure"/);
  });

  it('when every answer model fails, a traced preview still emits trace_usage with each attempt (status + code, no provider text); production does not', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'preview');
    state.failModels = new Set(['mindy-staging-forced-failure', 'gpt-4o-mini']);
    vi.resetModules();
    const mk = () => new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'fallback-mini' }, body: JSON.stringify({ email: ME, message: 'How do I write a capability statement?' }) });
    const raw = await (await (await import('./route')).POST(mk() as never)).text();
    const events = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
    const tu = events.find((e) => e.type === 'trace_usage');
    expect(tu?.answer).toBeNull();
    expect(tu?.answer_attempts?.map((a: { model: string }) => a.model)).toEqual(['mindy-staging-forced-failure', 'gpt-4o-mini']);
    expect(tu?.answer_attempts?.every((a: { status: number | null }) => typeof a.status === 'number')).toBe(true);
    expect(raw).not.toContain(SECRET); // provider free text never reaches the stream, trace included
    expect(events.find((e) => e.type === 'error')?.code).toBe('answer_unavailable');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.resetModules();
    const prodRaw = await (await (await import('./route')).POST(mk() as never)).text();
    expect(prodRaw).not.toMatch(/trace_usage|answer_attempts/);
  });

  it('an unknown config name is ignored', async () => {
    vi.stubEnv('ASK_MINDY_TRACE_EVENTS', 'true'); vi.stubEnv('VERCEL_ENV', 'preview');
    vi.resetModules();
    const { POST } = await import('./route');
    await (await POST(new Request('https://x/api/app/chat', { method: 'POST', headers: { 'x-ask-mindy-staging-config': 'gpt-6-astra' }, body: JSON.stringify({ email: ME, message: 'How do I write a capability statement?' }) }) as never)).text();
    expect(state.answerModels).toEqual(['gpt-4o']);
  });
});

describe('gpt-6-luna as the PLANNER (gpt-4o / gpt-4o-mini shut down 2027-01-14)', () => {
  const Q = 'What janitorial opportunities are open in Florida right now?';
  const call = { id: 'c1', function: { name: 'search_sam_opportunities', arguments: JSON.stringify({ keyword: 'janitorial', state: 'FL' }) } };

  it('as the planner fallback: terra fails, luna plans with GPT-6 params and its tool call runs', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra');
    vi.stubEnv('CHAT_PLANNER_FALLBACKS', 'openai:gpt-6-luna');
    vi.stubEnv('CHAT_ANSWER_FALLBACKS', 'openai:gpt-6-luna');
    state.plannerFailModels = new Set(['gpt-6.1-terra']);
    state.plannerCalls = [call];
    const { events } = await ask(Q);
    expect(state.plannerModels).toEqual(['gpt-6.1-terra', 'gpt-6-luna']);
    const luna = state.plannerBodies[1];
    expect(luna).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
    expect(luna.max_completion_tokens).toBeGreaterThan(0);
    expect(luna).not.toHaveProperty('temperature');
    expect(luna).not.toHaveProperty('max_tokens');
    expect(Array.isArray(luna.tools) && (luna.tools as unknown[]).length).toBeTruthy();
    expect(luna.tool_choice).toBe('required'); // open-opportunity intent forces a tool, unchanged for luna
    expect(state.executed).toEqual([['search_sam_opportunities']]);
    expect(state.answerModels).toEqual(['gpt-6.1-terra']);
    expect(JSON.stringify(events)).not.toMatch(/req_9f2|sk-live|context_length/);
  });

  it('as the over-budget planner + answer (LLM_OPENAI_MODEL=gpt-6-luna): luna plans with GPT-6 params', async () => {
    budget.over = true;
    vi.stubEnv('LLM_OPENAI_MODEL', 'gpt-6-luna');
    state.plannerCalls = [call];
    await ask(Q);
    expect(state.plannerModels).toEqual(['gpt-6-luna']);
    expect(state.plannerBodies[0]).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none' });
    expect(state.plannerBodies[0]).not.toHaveProperty('temperature');
    expect(state.executed).toEqual([['search_sam_opportunities']]);
    expect(state.answerModels).toEqual(['gpt-6-luna']);
  });

  it('today\'s production env is unchanged: planner fallback stays gpt-4o', async () => {
    vi.stubEnv('CHAT_OPENAI_MODEL', 'gpt-6.1-terra');
    vi.stubEnv('CHAT_PLANNER_FALLBACKS', 'openai:gpt-4o');
    state.plannerFailModels = new Set(['gpt-6.1-terra']);
    state.plannerCalls = [call];
    await ask(Q);
    expect(state.plannerModels).toEqual(['gpt-6.1-terra', 'gpt-4o']);
    expect(state.plannerBodies[1]).toMatchObject({ temperature: 0 });
  });
});

describe('map "ask about this view": no place the customer did not give (2026-11-15 Birmingham defect)', () => {
  const VIEW_Q = '[Current map view \u2014 853+ Open Now opps in view. Location: the map area is in VA, MD, PA (plotted pins in view, most first: VA 312, MD 140, PA 90). Answer for THIS view when the question is about "these"/"this"/"here": use this location, not the user\'s saved profile locations, and do not choose a city the user did not name.]\n\nWhich agencies buy the most in this view?';

  it('a planner call with a profile state and an invented city runs on the view states, with no city', async () => {
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: JSON.stringify({ state: 'AL', city: 'Birmingham', metro_radius_miles: 30, naics: ['2362'] }) } }];
    await ask(VIEW_Q);
    expect(state.executedArgs).toHaveLength(1);
    expect(state.executedArgs[0]).not.toHaveProperty('city');
    expect(state.executedArgs[0]).not.toHaveProperty('metro_radius_miles');
    // The profile state AL is gone; the search is scoped to every state in view (none dropped).
    expect(String(state.executedArgs[0].state).split(',').sort()).toEqual(['MD', 'PA', 'VA']);
  });

  it('a state the view preamble names is kept', async () => {
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: JSON.stringify({ state: 'VA', naics: ['2362'] }) } }];
    await ask(VIEW_Q);
    expect(String(state.executedArgs[0].state).split(',').sort()).toEqual(['MD', 'PA', 'VA']);
  });

  it('the customer sees the map scope labeled as the MAP\'s, never "From your request"', async () => {
    state.toolContent = JSON.stringify({ contracts: [{ piid: 'A1', description: 'Janitorial services', place_of_performance_state: 'VA', period_of_performance_current_end: '2027-06-30', total_obligation: 500000 }], expiring_orders_in_window: [], _meta: { total: 1 } });
    state.plannerCalls = [{ id: 'c1', function: { name: 'get_expiring_contracts', arguments: JSON.stringify({ naics: '561720', months_window: 12 }) } }];
    const recompeteQ = VIEW_Q.replace('Which agencies buy the most in this view?', 'Which janitorial contracts expire in the next 12 months in this view?');
    const { raw } = await ask(recompeteQ);
    const shown = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).filter((e) => e.type === 'token').map((e) => e.content).join('');
    expect(String(state.executedArgs[0].state).split(',').sort()).toEqual(['MD', 'PA', 'VA']);
    expect(shown).toContain('Scoped to the states on your map: VA, MD, PA.');
    expect(shown).not.toMatch(/From your request:[^\n]*states/);
    expect(shown).not.toMatch(/states VA, MD, PA from your request/);
  });

  it('a state the customer typed is still labeled "From your request"', async () => {
    state.toolContent = JSON.stringify({ contracts: [{ piid: 'A1', description: 'Janitorial services', place_of_performance_state: 'TX', period_of_performance_current_end: '2027-06-30', total_obligation: 500000 }], expiring_orders_in_window: [], _meta: { total: 1 } });
    state.plannerCalls = [{ id: 'c1', function: { name: 'get_expiring_contracts', arguments: JSON.stringify({ naics: '561720', months_window: 12 }) } }];
    const { raw } = await ask('Which janitorial contracts expire in the next 12 months in TX?');
    const shown = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).filter((e) => e.type === 'token').map((e) => e.content).join('');
    expect(shown).toMatch(/From your request: [^\n]*states TX from your request/);
    expect(shown).not.toContain('on your map');
  });

  it('map industry filter: labeled "from your map\'s industry filter", never "for the work you named" or "chosen by Mindy"', async () => {
    state.toolContent = JSON.stringify({ contracts: [{ piid: 'A1', description: 'Office building renovation', place_of_performance_state: 'CA', period_of_performance_current_end: '2027-06-30', total_obligation: 900000 }], expiring_orders_in_window: [], _meta: { total: 1, applied_filters: { naics: ['236220'] } } });
    state.plannerCalls = [{ id: 'c1', function: { name: 'get_expiring_contracts', arguments: JSON.stringify({ months_window: 12 }) } }];
    const q = '[Current map view \u2014 40 Open Now opps in view; NAICS 236220. Location: the map is filtered to CA. Answer for THIS view when the question is about "these"/"this"/"here": use this location, not the user\'s saved profile locations, and do not choose a city the user did not name.]\n\nWhich contracts expire in the next 12 months here?';
    const { raw } = await ask(q);
    const shown = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).filter((e) => e.type === 'token').map((e) => e.content).join('');
    expect(state.executedArgs[0]).toMatchObject({ naics: '236220', state: 'CA' });
    expect(shown).toContain("Industry codes 236220 from your map's industry filter.");
    expect(shown).toContain("Scoped to your map's state filter: CA.");
    expect(shown).not.toMatch(/for the work you named/);
    expect(shown).not.toMatch(/chosen by Mindy/);
    expect(shown).not.toMatch(/From your request:/);
  });

  it('a city the customer typed is kept', async () => {
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: JSON.stringify({ state: 'TN', city: 'Memphis' }) } }];
    await ask('Which offices buy janitorial services in Memphis, TN?');
    expect(state.executedArgs[0]).toMatchObject({ state: 'TN', city: 'Memphis' });
  });
});

describe('incumbent wording rule (2026-11-15 smoke: "it appears there is no incumbent")', () => {
  it('the answer model is told to name an incumbent only when identified and never to claim absence', async () => {
    await ask('Who is the incumbent on solicitation 70Z08726QKEYWEST?');
    const system = String(state.answerMessages[0]?.[0]?.content ?? '');
    expect(system).toContain('name one only when _meta.incumbent_finding is "identified"');
    expect(system).toContain('Never say "there is no incumbent"');
  });
});

describe('F1: a CURRENT_FIND question uses find_opportunities across three horizons (same contract as the MCP)', () => {
  const ERIC_Q = '[Current map view \u2014 995+ Open Now opps in view; in OH, VA, PA, DC. Location: the map area is in OH, VA, PA, DC, NC, AL (plotted pins in view, most first: OH 868, VA 90, PA 27, DC 2, NC 2, AL 1). Answer for THIS view when the question is about "these"/"this"/"here": use this location, not the user\'s saved profile locations, and do not choose a city the user did not name.]\n\nWhat open opportunities are there for janitorial services in Florida?';

  it("Eric's side-by-side question: only find_opportunities is offered (not the open-only search), and horizons the planner turned off come back", async () => {
    state.extraOffered = ['find_opportunities'];
    state.plannerCalls = [{ id: 'c1', function: { name: 'find_opportunities', arguments: JSON.stringify({ query: 'janitorial services', location: 'Florida', advanced: { naics: '561720' }, horizons: { open_now: true, coming_back: false, coming_soon: false } }) } }];
    await ask(ERIC_Q);
    expect(state.offered[0]).toEqual(['find_opportunities']);
    expect(state.executed).toEqual([['find_opportunities']]);
    // Same input Claude sends via the MCP: the customer's words, all three horizons, 25 rows, no planner-chosen NAICS.
    expect(state.executedArgs[0]).toEqual({ tool: 'find_opportunities', query: 'janitorial services', location: 'Florida', horizons: { open_now: true, coming_back: true, coming_soon: true }, limit_per_horizon: 25 });
    const system = String(state.answerMessages[0]?.[0]?.content ?? '');
    expect(system).toContain('FINDING OPPORTUNITIES (same contract as the Mindy MCP)');
    expect(system).toContain('Present three sections in this order: Open now, Coming back, Coming soon');
  });

  it('a follow-up refinement ("What about in Florida?") gets the same three-horizon FIND input', async () => {
    state.extraOffered = ['find_opportunities'];
    state.plannerCalls = [{ id: 'c1', function: { name: 'find_opportunities', arguments: JSON.stringify({ query: 'security guard', location: 'Florida' }) } }];
    vi.resetModules();
    const { POST } = await import('./route');
    await (await POST(new Request('https://getmindy.ai/api/app/chat', { method: 'POST', body: JSON.stringify({ email: ME, message: 'What about in Florida?', history: [{ role: 'user', content: 'What security guard opportunities are open right now?' }, { role: 'assistant', content: 'Here are open security guard opportunities.' }] }) }) as never)).text();
    expect(state.offered[0]).toEqual(['find_opportunities']);
    expect(state.executedArgs[0]).toMatchObject({ query: 'security guard', location: 'Florida', limit_per_horizon: 25 });
  });

  it('an answer that leaves out horizons is completed from the find_opportunities summary (counts only, never rows)', async () => {
    state.extraOffered = ['find_opportunities'];
    state.toolContent = JSON.stringify({ horizons: {}, summary: { open_now: { status: 'grounded', matched_count: 9 }, coming_back: { status: 'grounded', matched_count: 80, direct_match: 44, related_market_candidate: 36 }, coming_soon: { status: 'unavailable', matched_count: null } }, _meta: { grounded: true } });
    state.plannerCalls = [{ id: 'c1', function: { name: 'find_opportunities', arguments: JSON.stringify({ query: 'janitorial services', location: 'Florida' }) } }];
    const { events } = await ask(ERIC_Q); // the stub answer is "Review the records above." (no horizon headings)
    const shown = events.filter((e) => e.type === 'token').map((e) => e.content).join('');
    expect(shown).toContain('**Open now:** 9 open notices matched the search');
    expect(shown).toContain('**Coming back:** 80 expiring contracts matched (44 direct, 36 related-market, not confirmed); these are not open solicitations.');
    expect(shown).toContain('**Coming soon:** could not be checked this time (not a zero).');
  });

  it('an explicit open-only request keeps the open-only search and its horizons', async () => {
    state.extraOffered = ['find_opportunities'];
    state.plannerCalls = [{ id: 'c1', function: { name: 'search_sam_opportunities', arguments: JSON.stringify({ keyword: 'janitorial', state: 'FL' }) } }];
    await ask('Show me only open solicitations for janitorial in FL');
    expect(state.offered[0]).toEqual(expect.arrayContaining(['search_sam_opportunities', 'find_opportunities']));
    expect(state.executed).toEqual([['search_sam_opportunities']]);
  });

  it('a recompete question is unchanged: every tool still offered', async () => {
    state.extraOffered = ['find_opportunities'];
    await ask('Which security guard contracts are expiring in the next 12 months?');
    expect(state.offered[0]).toEqual(['get_expiring_contracts', 'search_sam_opportunities', 'find_opportunities']);
  });

  it('the map view preamble alone does not make a question a FIND ("Open Now opps in view" is not the customer\'s words)', async () => {
    state.extraOffered = ['find_opportunities'];
    await ask(ERIC_Q.replace('What open opportunities are there for janitorial services in Florida?', 'Which agencies spend the most on facilities here?'));
    expect(state.offered[0]).toEqual(['get_expiring_contracts', 'search_sam_opportunities', 'find_opportunities']);
  });
});
