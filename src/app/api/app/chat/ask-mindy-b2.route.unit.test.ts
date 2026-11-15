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
  toolContent: string;
  toolStatus: 'success' | 'failed';
  answerModels: string[];
  answerUrls: string[];
  failModels: Set<string>;
  answerThrows: boolean;
  answerMessages: Array<Array<{ role: string; content: string }>>;
} = {} as never;

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));
vi.mock('@/lib/chat/chat-tool-executor', () => ({
  createChatToolExecutor: () => ({
    offeredToolDefs: () => ['get_expiring_contracts', 'search_sam_opportunities'].map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } })),
    executeRound: async (calls: ToolCall[]) => {
      state.executed.push(calls.map((c) => c.function.name));
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
    plannerCalls: [], offered: [], executed: [], toolContent: '{"ok":true,"results":[]}', toolStatus: 'success',
    answerModels: [], answerUrls: [], failModels: new Set(), answerThrows: false, answerMessages: [],
  });
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (!b.stream) {
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
