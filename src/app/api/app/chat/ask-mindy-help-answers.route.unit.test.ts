/**
 * Help answers (beta, ASK_MINDY_HELP_ANSWERS, default off) through the real route. Harness copied from
 * ask-mindy-research-mode.route.unit.test.ts. Synthetic names only.
 *   - Flag off: a how-to question takes the existing path.
 *   - Flag on: a how-to question is answered from the register: no planner, no tools, no research run, and the saved
 *     trace (engine help_answer) does not count toward the research cap.
 *   - Flag on: an ordinary research question, or a turn with screenshots, runs exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  runGate: vi.fn(),
  extract: vi.fn(),
  create: vi.fn(),
  overBudget: false,
  capUsed: 0,
  afterFns: [] as Array<() => unknown>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
  chain.insert = vi.fn((row: unknown) => { for (const r of Array.isArray(row) ? row : [row]) h.inserts.push(r as Record<string, unknown>); return chain; });
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => ({}), loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => h.overBudget), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));
vi.mock('@/lib/ask-mindy/company-profile', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/company-profile')>()), loadCompanyProfile: vi.fn(async () => ({ status: 'ok', workspace: 'own', profile: { companyName: 'Acme Clean', certifications: [{ name: 'WOSB', source: 'self_reported' }], unknown: [] } })) }));
vi.mock('@/lib/ask-mindy/intelligence-gate', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/intelligence-gate')>()), runIntelligenceGate: h.runGate }));
vi.mock('@/lib/ask-mindy/gate-intent', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/gate-intent')>()), extractWorkPhrase: h.extract }));

vi.mock('@/lib/ask-mindy/research-caps-deps', () => ({
  researchCapDeps: {
    facts: async () => ({ staff: false, appTier: 'pro', access: { level: 'pro', source: 'stripe' }, mcpPlan: null }),
    todaysTraces: async () => Array.from({ length: h.capUsed }, () => ({ engine: 'research_mode', call_count: 2 })),
  },
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { h.afterFns.push(fn); } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: (...a: unknown[]) => h.create(...a) }; } }));

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ASK_MINDY_INTELLIGENCE_GATE', 'ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST', 'ASK_MINDY_RESEARCH_MODE', 'ASK_MINDY_RESEARCH_MODE_ALLOWLIST', 'ASK_MINDY_RESEARCH_MODEL', 'ASK_MINDY_HELP_ANSWERS', 'ASK_MINDY_HELP_ANSWERS_ALLOWLIST'] as const;
const saved: Record<string, string | undefined> = {};
const openaiCalls: string[] = [];
const openaiTools: string[] = [];
const EMAIL = 'erika@example.com';
const Q = 'Give me a full assessment of Ridgeline Digital.';
type Block = Record<string, unknown>;
const reply = (content: Block[], stop: string) => ({ content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } });

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  openaiCalls.length = 0; openaiTools.length = 0; h.inserts.length = 0; h.overBudget = false; h.capUsed = 0; h.afterFns.length = 0;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({ result: { ok: true, grounded: true, tool: name, note: 'obligated $1.2M' }, credits: 0 }));
  h.runGate.mockReset(); h.extract.mockReset(); h.extract.mockImplementation(async () => 'digital marketing');
  h.create.mockReset();
  let step = 0;
  h.create.mockImplementation(async () => (++step === 1
    ? reply([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'find_opportunities', input: { query: 'digital marketing' } }, { type: 'tool_use', id: 'tu2', name: 'search_contractors', input: { keyword: 'Ridgeline' } }], 'tool_use')
    : reply([{ type: 'text', text: 'Start with the Navy recruiting campaign ($1.2M awarded so far).' }], 'end_turn')));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    openaiCalls.push(String(url));
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    for (const t of ((body.tools as Array<{ function?: { name?: string } }>) || [])) openaiTools.push(String(t.function?.name));
    return isPlannerCall(body) ? plannerResponse([]) : answerStream(['Existing path answer.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ask(message: string): Promise<SseEvent[]> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withinMs(readSse(await POST(chatRequest({ message, email: EMAIL }) as any)), 5000, 'chat stream');
}
const text = (ev: SseEvent[]) => ev.filter((e) => e.type === 'token').map((e) => (e as { content: string }).content).join('');
const flagOn = () => { process.env.ASK_MINDY_RESEARCH_MODE = 'true'; process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST = EMAIL; };
const savedTrace = async () => { await new Promise((r) => setTimeout(r, 20)); return (h.inserts.find((r) => r.role === 'assistant') as { trace?: Record<string, unknown> } | undefined)?.trace; };

const helpOn = () => { process.env.ASK_MINDY_HELP_ANSWERS = 'true'; process.env.ASK_MINDY_HELP_ANSWERS_ALLOWLIST = EMAIL; };
const HOW_TO = 'How do I cancel my subscription?';

describe('help answers in the chat route', () => {
  it('flag off: a how-to question takes the existing path', async () => {
    const ev = await ask(HOW_TO);
    expect(text(ev)).toContain('Existing path answer.');
    expect(openaiCalls.length).toBeGreaterThan(0);
  });

  it('flag on: answered from the register with no planner, no tools and no research run, even with research mode on', async () => {
    helpOn(); flagOn();
    const ev = await ask(HOW_TO);
    expect(text(ev)).toContain('**Manage / cancel**');
    expect(text(ev)).toContain('Help answers are in beta.');
    expect(ev.map((e) => e.type)).toEqual(['session', 'token', 'citations', 'done']);
    expect(openaiCalls).toHaveLength(0);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.runMcpTool).not.toHaveBeenCalled();
    const trace = await savedTrace();
    expect(trace).toEqual({ engine: 'help_answer', help_id: 'cancel_subscription', help_kind: 'product' });
    const { countsTowardCap } = await import('@/lib/ask-mindy/research-caps');
    expect(countsTowardCap(trace)).toBe(false);
  });

  it('flag on: a research question runs exactly as before', async () => {
    helpOn();
    const ev = await ask('Find me cybersecurity work in Florida');
    expect(text(ev)).toContain('Existing path answer.');
    expect(text(ev)).not.toContain('Help answers are in beta.');
  });

  it('flag on: a turn with a screenshot is never given a help answer', async () => {
    helpOn();
    const { POST } = await import('./route');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]).toString('base64');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(chatRequest({ message: HOW_TO, email: EMAIL, images: [{ media_type: 'image/png', data: png }] } as any) as any);
    expect(res.status).toBe(200);
    const ev = await withinMs(readSse(res), 5000, 'chat stream');
    expect(text(ev)).not.toContain('Help answers are in beta.');
  });
});
