/**
 * Federal Strategy Plan through the real route (ASK_MINDY_STRATEGY_PLAN, default off).
 *   - Flag off: a strategy ask is handled exactly as before (FIND contract; a report ask still forces the packaged
 *     market report).
 *   - Flag on for the verified email: the EXISTING Federal Market Profile research workflow runs (phase machine)
 *     with the general strategy contract in place of the RBA one, and the saved company profile opens the turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({ runMcpTool: vi.fn() }));

vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is', 'insert']) chain[m] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => ({}), loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ASK_MINDY_STRATEGY_PLAN', 'ASK_MINDY_STRATEGY_PLAN_ALLOWLIST'] as const;
const saved: Record<string, string | undefined> = {};
const calls: Array<{ kind: 'planner' | 'answer'; body: Record<string, unknown> }> = [];
const EMAIL = 'erika@example.com';

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  delete process.env.ASK_MINDY_STRATEGY_PLAN;
  delete process.env.ASK_MINDY_STRATEGY_PLAN_ALLOWLIST;
  calls.length = 0;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async () => ({ result: { ok: true }, credits: 0 }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const kind = isPlannerCall(body) ? 'planner' : 'answer';
    calls.push({ kind, body });
    return kind === 'planner' ? plannerResponse([]) : answerStream(['Here is the plan.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ask(message: string): Promise<{ ev: SseEvent[]; system: string; plannerTools: string[]; toolChoice: unknown }> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = await withinMs(readSse(await POST(chatRequest({ message, email: EMAIL }) as any)), 5000, 'chat stream');
  const planner = calls.find((c) => c.kind === 'planner')!.body;
  const msgs = planner.messages as Array<{ role: string; content: string }>;
  return {
    ev,
    system: msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
    plannerTools: (planner.tools as Array<{ function: { name: string } }>).map((t) => t.function.name),
    toolChoice: planner.tool_choice,
  };
}

const ASK = 'Write a federal strategy plan and comprehensive market research report for Ridgeline Test Facilities';

describe('Federal Strategy Plan route wiring', () => {
  it('flag off: unchanged (no strategy contract; the report ask still forces generate_market_report)', async () => {
    const r = await ask(ASK);
    expect(r.system).not.toContain('FEDERAL STRATEGY PLAN');
    expect(r.plannerTools).toContain('generate_market_report');
    expect(JSON.stringify(r.toolChoice)).toContain('generate_market_report');
  });

  it('flag on (allowlist, this email): the existing research workflow runs with the strategy contract, profile first', async () => {
    process.env.ASK_MINDY_STRATEGY_PLAN = 'allowlist';
    process.env.ASK_MINDY_STRATEGY_PLAN_ALLOWLIST = EMAIL;
    const r = await ask(ASK);
    expect(r.system).toContain('FEDERAL STRATEGY PLAN');
    expect(r.system).toContain('identity -> awards -> pathways -> vehicles -> market_size -> contacts -> web -> writeup');
    // the RBA-specific contract is not used for a strategy ask
    expect(r.system).not.toContain('FEDERAL MARKET PROFILE (company-first pathway report — not a keyword market-size report)');
    // step 1: the saved profile (or why it is unavailable) opens the research
    expect(r.system).toMatch(/COMPANY PROFILE/);
    // the phase machine owns order: the packaged market report is not forced up front
    expect(JSON.stringify(r.toolChoice ?? '')).not.toContain('generate_market_report');
    expect(r.plannerTools).not.toContain('generate_market_report');
  });

  it('flag on, but another email: unchanged', async () => {
    process.env.ASK_MINDY_STRATEGY_PLAN = 'allowlist';
    process.env.ASK_MINDY_STRATEGY_PLAN_ALLOWLIST = 'someone-else@example.com';
    const r = await ask(ASK);
    expect(r.system).not.toContain('FEDERAL STRATEGY PLAN');
  });

  it('flag on, a question that is not a plan: unchanged', async () => {
    process.env.ASK_MINDY_STRATEGY_PLAN = 'true';
    const r = await ask('Find open HVAC maintenance opportunities in Georgia');
    expect(r.system).not.toContain('FEDERAL STRATEGY PLAN');
  });
});
