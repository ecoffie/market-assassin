/**
 * Ask Mindy intelligence gate through the real route (ASK_MINDY_INTELLIGENCE_GATE, default off).
 *   - Flag off: a market question takes the existing path (planner runs; the gate never does).
 *   - Flag on: a market question whose words name the work streams the gate's decision, the market_report event
 *     the Ask pane opens, and a History trace that restores it. The OpenAI planner is never called.
 *   - Flag on, not a market question (or no work phrase): unchanged existing path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  runGate: vi.fn(),
  extract: vi.fn(),
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
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));
vi.mock('@/lib/ask-mindy/company-profile', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/company-profile')>()), loadCompanyProfile: vi.fn(async () => ({ status: 'ok', workspace: 'own', profile: { companyName: 'Acme Clean', certifications: [{ name: 'WOSB', source: 'self_reported' }], unknown: [] } })) }));
vi.mock('@/lib/ask-mindy/intelligence-gate', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/intelligence-gate')>()), runIntelligenceGate: h.runGate }));
vi.mock('@/lib/ask-mindy/gate-intent', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/gate-intent')>()), extractWorkPhrase: h.extract }));

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ASK_MINDY_INTELLIGENCE_GATE', 'ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST'] as const;
const saved: Record<string, string | undefined> = {};
const calls: Array<{ kind: 'planner' | 'answer' }> = [];
const EMAIL = 'erika@example.com';
const FL_Q = 'What open opportunities are there for janitorial services in Florida?';

const gateResult = {
  status: 'complete', attempts: 1,
  decision: { headline: 'Start with West Palm Beach.', pursuits: [], ruled_out: '', gaps: [], next_question: 'Are you small?' },
  evaluation: { pass: true, results: [{ criterion: 'clear', pass: true, reason: 'ok' }], fix: [] },
  checks: [{ contract_id: 'CONT_AWD_X', verdict: 'pursue', exclusions: [], barriers: [], actions: [{ code: 'capture_window_passed', detail: 'd' }] }],
  report: { subject: 'janitorial services', deliverable: { html: '<html>brief</html>', url: 'https://getmindy.ai/reports/r1', report_id: 'r1' } },
  answer: 'Start with West Palm Beach.\n\nAre you small?',
  cost: { analystIn: 10, analystOut: 5, evalIn: 4, evalOut: 2 },
};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  delete process.env.ASK_MINDY_INTELLIGENCE_GATE;
  delete process.env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST;
  calls.length = 0;
  h.inserts.length = 0;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async () => ({ result: { ok: true }, credits: 0 }));
  h.runGate.mockReset();
  h.runGate.mockImplementation(async () => gateResult);
  h.extract.mockReset();
  h.extract.mockImplementation(async () => 'janitorial services');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const kind = isPlannerCall(body) ? 'planner' : 'answer';
    calls.push({ kind });
    return kind === 'planner' ? plannerResponse([]) : answerStream(['Existing path answer.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
const flagOn = () => { process.env.ASK_MINDY_INTELLIGENCE_GATE = 'true'; process.env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST = EMAIL; };

describe('intelligence gate in the chat route', () => {
  it('flag off: the existing path answers and the gate never runs', async () => {
    const ev = await ask(FL_Q);
    expect(h.runGate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.kind === 'planner')).toBe(true);
    expect(text(ev)).toContain('Existing path answer.');
  });

  it('flag on: streams the decision, the market_report event, and skips the OpenAI planner', async () => {
    flagOn();
    const ev = await ask(FL_Q);
    expect(h.runGate).toHaveBeenCalledTimes(1);
    const arg = h.runGate.mock.calls[0][0];
    expect(arg.reportInput).toMatchObject({ keyword: 'janitorial services', state: 'FL' });
    expect(arg.profile).toContain('Acme Clean');
    expect(arg.eligibility).toEqual({ certifications: ['WOSB'], uei: null });
    expect(text(ev)).toBe(gateResult.answer);
    const mr = ev.find((e) => e.type === 'market_report') as Record<string, unknown> | undefined;
    expect(mr).toMatchObject({ report_id: 'r1', url: 'https://getmindy.ai/reports/r1', title: 'janitorial services', html: '<html>brief</html>' });
    expect(ev[ev.length - 1].type).toBe('done');
    expect(calls).toHaveLength(0);
  });

  it('flag on: the saved turn carries the gate trace and the report card for History', async () => {
    flagOn();
    await ask(FL_Q);
    await new Promise((r) => setTimeout(r, 20));
    const assistant = h.inserts.find((r) => r.role === 'assistant') as { trace?: Record<string, unknown> } | undefined;
    expect(assistant?.trace).toMatchObject({ engine: 'intelligence_gate', gate_status: 'complete', work: 'janitorial services', states: ['FL'], market_report: { report_id: 'r1', html: '' } });
  });

  it('flag on: a non-market question takes the existing path', async () => {
    flagOn();
    await ask('Has the FY2026 NDAA become law?');
    expect(h.runGate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.kind === 'planner')).toBe(true);
  });

  it('flag on: no verbatim work phrase means the existing path', async () => {
    flagOn();
    h.extract.mockImplementation(async () => null);
    await ask(FL_Q);
    expect(h.runGate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.kind === 'planner')).toBe(true);
  });

  it('flag on: a gate error falls through so the customer still gets an answer', async () => {
    flagOn();
    h.runGate.mockImplementation(async () => { throw new Error('boom'); });
    const ev = await ask(FL_Q);
    expect(text(ev)).toContain('Existing path answer.');
  });
});
