/**
 * Ask Mindy route reliability (audit A7 + A6, P1a): a hung tool, planner or answer provider must never
 * silently end a response, the stream always ends with `done` (after `error` when it failed), and every
 * non-success tool status tells the user the answer may be incomplete.
 *
 * Drives the REAL route handler: only auth, profile, telemetry, storage and the providers are faked.
 * Deadlines are shortened through the same env variables production reads (defaults live in
 * src/lib/chat/turn-deadlines.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hangingFetch, plannerResponse, answerStream, stallingAnswerStream, isPlannerCall,
  readSse, answerText, chatRequest, withinMs, type SseEvent,
} from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  loadBidderProfile: vi.fn(async () => ({})),
  failCardTurn: vi.fn(async () => {}),
  claimCardTurn: vi.fn(),
  recordLlmUsage: vi.fn(async () => {}),
  table: '',
  record: null as Record<string, unknown> | null,
}));

vi.mock('@supabase/supabase-js', () => {
  // Every query resolves to "no row, no error"; writes succeed.
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn((t: string) => { h.table = t; return chain; });
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: h.table === 'sam_opportunities' ? h.record : null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: h.loadBidderProfile, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: h.recordLlmUsage }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({
  parseTurnId: (v: unknown) => (typeof v === 'string' ? v : null),
  claimCardTurn: h.claimCardTurn, completeCardTurn: vi.fn(), failCardTurn: h.failCardTurn,
}));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));

const ENV_KEYS = ['OPENAI_API_KEY', 'MAP_CARD_CHAT_ENABLED', 'CHAT_TOOL_TIMEOUT_MS', 'CHAT_PLANNER_TIMEOUT_MS', 'CHAT_ANSWER_CONNECT_TIMEOUT_MS', 'CHAT_ANSWER_IDLE_TIMEOUT_MS', 'CHAT_TURN_DEADLINE_MS', 'CHAT_TOOL_ROUND_BUDGET_MS'] as const;
const savedEnv: Record<string, string | undefined> = {};

type FetchPlan = {
  planner?: (init: RequestInit) => Promise<Response>;
  answer?: (init: RequestInit) => Promise<Response>;
};
let plan: FetchPlan = {};
const fetchCalls: Array<{ kind: 'planner' | 'answer'; body: Record<string, unknown> }> = [];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  // Short deadlines so a hang shows up in milliseconds, not minutes.
  process.env.CHAT_TOOL_TIMEOUT_MS = '150';
  process.env.CHAT_PLANNER_TIMEOUT_MS = '150';
  process.env.CHAT_ANSWER_CONNECT_TIMEOUT_MS = '150';
  process.env.CHAT_ANSWER_IDLE_TIMEOUT_MS = '150';
  process.env.CHAT_TOOL_ROUND_BUDGET_MS = '600';
  process.env.CHAT_TURN_DEADLINE_MS = '1500';
  fetchCalls.length = 0;
  plan = {};
  h.runMcpTool.mockReset();
  h.runMcpTool.mockResolvedValue({ result: { ok: true, agency: 'Department of Energy', pain_points: ['grid'], _meta: { grounded: true, degraded: false, result_state: 'known', ignored_args: [] } }, credits: 0 });
  h.failCardTurn.mockClear();
  h.recordLlmUsage.mockClear();
  h.claimCardTurn.mockReset();
  h.record = null;
  h.loadBidderProfile.mockReset();
  h.loadBidderProfile.mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const kind = isPlannerCall(body) ? 'planner' : 'answer';
    fetchCalls.push({ kind, body });
    const handler = kind === 'planner' ? plan.planner : plan.answer;
    if (handler) return handler(init);
    return kind === 'planner' ? plannerResponse([]) : answerStream(['Hello ', 'there.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ask(message: string, extra: Record<string, unknown> = {}): Promise<SseEvent[]> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(chatRequest({ message, ...extra }) as any);
  return withinMs(readSse(res), 5000, 'chat stream');
}

const types = (ev: SseEvent[]) => ev.map((e) => e.type);
const notices = (ev: SseEvent[]) => ev.filter((e) => e.type === 'notice').map((e) => String(e.code));

describe('successful chat is unchanged', () => {
  it('a turn with one successful tool streams the answer, citations and done, with no notice', async () => {
    plan.planner = async () => plannerResponse([{ name: 'get_agency_intel', args: { agency: 'Department of Energy' } }]);
    plan.answer = async () => answerStream(['DOE lists grid ', 'modernization.']);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(types(ev)[0]).toBe('session');
    expect(answerText(ev)).toBe('DOE lists grid modernization.');
    expect(notices(ev)).toEqual([]);
    expect(types(ev).filter((t) => t === 'error')).toEqual([]);
    expect(types(ev).slice(-2)).toEqual(['citations', 'done']);
    expect(h.runMcpTool).toHaveBeenCalledTimes(1);
  });

  it('a no-tool turn streams the answer and done', async () => {
    const ev = await ask('hello');
    expect(answerText(ev)).toBe('Hello there.');
    expect(types(ev).at(-1)).toBe('done');
    expect(notices(ev)).toEqual([]);
  });
});

describe('A7: timeouts — a hang never silently ends the response', () => {
  it('a tool that never resolves is cut off, the user is told, and the answer still streams', async () => {
    h.runMcpTool.mockImplementation(() => new Promise(() => {}));
    plan.planner = async () => plannerResponse([{ name: 'get_agency_intel', args: { agency: 'Department of Energy' } }]);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(notices(ev)).toContain('lookup_failed');
    expect(answerText(ev)).toBe('Hello there.');
    expect(types(ev).at(-1)).toBe('done');
    // The model is told the lookup timed out (never an empty result).
    const answerBody = fetchCalls.find((c) => c.kind === 'answer')!.body;
    const toolMsg = (answerBody.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'tool');
    expect(JSON.parse(toolMsg!.content)).toMatchObject({ ok: false, error_category: 'tool_timeout' });
  });

  it('later calls in a round are refused once the round budget is spent', async () => {
    h.runMcpTool.mockImplementation(() => new Promise(() => {}));
    process.env.CHAT_TOOL_ROUND_BUDGET_MS = '200';
    plan.planner = async () => plannerResponse([
      { name: 'get_agency_intel', args: { agency: 'Department of Energy' }, id: 'a' },
      { name: 'get_agency_intel', args: { agency: 'Department of the Navy' }, id: 'b' },
      { name: 'get_agency_intel', args: { agency: 'Department of the Army' }, id: 'c' },
      { name: 'get_agency_intel', args: { agency: 'Department of the Interior' }, id: 'd' },
    ]);
    const started = Date.now();
    const ev = await ask('Pain points for DOE, Navy, Army and Interior?');
    expect(Date.now() - started).toBeLessThan(1400);
    expect(types(ev).at(-1)).toBe('done');
    const answerBody = fetchCalls.find((c) => c.kind === 'answer')!.body;
    const cats = (answerBody.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content).error_category);
    expect(cats).toContain('round_deadline_exceeded');
  });

  it('a planner that never responds is abandoned: tools_unavailable notice, answer, done', async () => {
    plan.planner = async (init) => hangingFetch(init.signal);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(notices(ev)).toContain('tools_unavailable');
    expect(answerText(ev)).toBe('Hello there.');
    expect(types(ev).at(-1)).toBe('done');
  });

  it('an answer provider that never connects ends with error then done', async () => {
    plan.answer = async (init) => hangingFetch(init.signal);
    const ev = await ask('hello');
    expect(types(ev).slice(-2)).toEqual(['error', 'done']);
  });

  it('an answer stream that stalls mid-answer is cut, flagged incomplete, and ends with done', async () => {
    plan.answer = async () => stallingAnswerStream(['Partial ']);
    const ev = await ask('hello');
    expect(answerText(ev)).toContain('Partial ');
    expect(ev.some((e) => e.type === 'truncated' || (e.type === 'notice' && e.code === 'answer_incomplete'))).toBe(true);
    expect(types(ev).at(-1)).toBe('done');
  });

  it('a turn that hangs before any provider call still ends with error then done (turn deadline)', async () => {
    h.loadBidderProfile.mockImplementation(() => new Promise(() => {}));
    process.env.CHAT_TURN_DEADLINE_MS = '300';
    const ev = await ask('hello');
    expect(types(ev).slice(-2)).toEqual(['error', 'done']);
    expect(ev.find((e) => e.type === 'error')!.code).toBe('turn_timeout');
  });
});

describe('LOW-1: nothing runs after the customer has seen the timeout', () => {
  it('a planner slower than the turn deadline runs no tool (not even a write) and sends no answer request', async () => {
    process.env.CHAT_TURN_DEADLINE_MS = '300';
    process.env.CHAT_PLANNER_TIMEOUT_MS = '5000';
    plan.planner = () => new Promise((r) => setTimeout(() => r(plannerResponse([
      { name: 'schedule_market_search', args: { naics: '541512', cadence: 'weekly', name: 'x' } },
    ])), 600));
    const ev = await ask('Set up a weekly search for 541512');
    expect(types(ev).slice(-2)).toEqual(['error', 'done']);
    expect(ev.find((e) => e.type === 'error')!.code).toBe('turn_timeout');
    // The route keeps running in the background: let the late planner response land.
    await new Promise((r) => setTimeout(r, 700));
    expect(h.runMcpTool).not.toHaveBeenCalled();
    expect(fetchCalls.filter((c) => c.kind === 'answer')).toHaveLength(0);
  });
});

describe('LOW-2: answer usage is recorded even when the watchdog cuts the stream', () => {
  it('records the chat answer usage on a watchdog cut', async () => {
    process.env.CHAT_TURN_DEADLINE_MS = '400';
    process.env.CHAT_ANSWER_IDLE_TIMEOUT_MS = '5000';
    plan.answer = async () => stallingAnswerStream(['Partial ']);
    const ev = await ask('hello');
    expect(types(ev).slice(-2)).toEqual(['error', 'done']);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.recordLlmUsage).toHaveBeenCalledWith(expect.objectContaining({ tool: 'chat', provider: 'openai' }));
  });
});

describe('B2: a card turn is released when the turn deadline fires', () => {
  it('the watchdog marks the claimed card turn failed (free, re-askable) instead of leaving it in progress', async () => {
    process.env.MAP_CARD_CHAT_ENABLED = 'true';
    process.env.CHAT_TURN_DEADLINE_MS = '300';
    h.record = { notice_id: '6ba812a7e0284f79bc44c4932777c340', title: 'Janitorial Services', solicitation_number: 'W912PL26Q0042', department: 'DEPT OF DEFENSE', ui_link: 'https://sam.gov/opp/x/view', active: true };
    h.claimCardTurn.mockImplementation(async (p: { replayOnly: boolean }) => (p.replayOnly ? { outcome: 'not_completed', sessionId: null } : { outcome: 'claimed', claimToken: 'tok-1', sessionId: null }));
    h.loadBidderProfile.mockImplementation(() => new Promise(() => {}));
    const ev = await ask('When is it due?', { context: { kind: 'opportunity', notice_id: '6ba812a7e0284f79bc44c4932777c340' }, turn_id: '0a0a0a0a-1111-4222-8333-444444444444' });
    expect(types(ev).slice(-2)).toEqual(['error', 'done']);
    expect(h.failCardTurn).toHaveBeenCalledWith(expect.objectContaining({ claimToken: 'tok-1', reason: 'turn_timeout' }));
  });
});

describe('A6: every non-success tool status is visible to the user', () => {
  it('a policy refusal (tool not allowed in chat) shows the incomplete notice', async () => {
    plan.planner = async () => plannerResponse([{ name: 'add_contacts_to_crm', args: { emails: ['a@b.com'] } }]);
    const ev = await ask('add these contacts');
    expect(notices(ev)).toContain('lookup_incomplete');
  });

  it('unparseable tool arguments (invalid_arguments refusal) show the incomplete notice', async () => {
    plan.planner = async () => plannerResponse([{ name: 'get_agency_intel', args: '{"agency": "DOE"' }]);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(notices(ev)).toContain('lookup_incomplete');
  });

  it('a thrown tool still shows the lookup_failed notice (unchanged behavior)', async () => {
    h.runMcpTool.mockRejectedValue(new Error('boom'));
    plan.planner = async () => plannerResponse([{ name: 'get_agency_intel', args: { agency: 'Department of Energy' } }]);
    const ev = await ask('What are the Department of Energy pain points?');
    expect(notices(ev)).toEqual(['lookup_failed']);
  });
});
