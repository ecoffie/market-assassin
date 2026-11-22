/**
 * CRITICAL REGRESSION 2026-11-22 (contract 36C24825C0020), as ONE connected conversation through the real route.
 *
 * Claude Local's browser run: the renewal results showed 36C24825C0020 as Blue Cord Design and Construction, $8.44M,
 * ending 2026-11-23. Asked whether that exact contract was worth pursuing, Ask Mindy named Daniels Building Co Inc,
 * $14M, ending 2026-10-15 (a different award, from get_solicitation_incumbent resolving the contract number to a
 * different notice) and wrote a pursuit plan.
 *
 * Five turns, each carrying the previous turns' history and signed source ledger exactly as the panel sends them:
 *   1. the renewal list (36C24825C0020 shown as an award)
 *   2. "is that exact contract worth pursuing?" with the planner making the original mistake and the tool returning
 *      the captured pre-fix answer (Daniels): the answer must be told it is NOT ABOUT the contract, pursuit blocked
 *   3. "who holds it and when does it end?" (no id: the conversation's contract) via get_award_detail: VERIFIED
 *   4. "give me a pursuit plan" while the saved profile cannot be read: reported unavailable, never silently empty
 *   5. "what next?": a suggested next step that repeats an earlier question is dropped
 * Tool payloads are the captured live responses (src/lib/chat/__fixtures__/contract-identity). The exact prompts of
 * Claude Local's run were not available to this session; these follow its reported sequence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, answerText, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';
import award from '@/lib/chat/__fixtures__/contract-identity/award-detail-36C24825C0020.json';
import preFixIncumbent from '@/lib/chat/__fixtures__/contract-identity/solicitation-incumbent-36C24825C0020.pre-fix.json';
import expiring from '@/lib/chat/__fixtures__/contract-identity/expiring-va-fl.json';

const h = vi.hoisted(() => ({
  runMcpTool: vi.fn(),
  profileResult: vi.fn(async () => ({ status: 'ok' as 'ok' | 'empty' | 'unavailable', profile: { naicsCodes: ['236220'] } as Record<string, unknown>, error: undefined as string | undefined })),
  callLLM: vi.fn(),
}));

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
vi.mock('@/lib/proposal/loaders', () => ({
  loadBidderProfile: async () => ({}),
  loadBidderProfileResult: h.profileResult,
  formatProfileForPrompt: () => 'USER PROFILE: NAICS 236220',
}));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));
vi.mock('@/lib/llm/call-llm', async (orig) => ({ ...(await orig<typeof import('@/lib/llm/call-llm')>()), callLLM: h.callLLM }));

const ID = '36C24825C0020';
const TOOL_RESULTS: Record<string, unknown> = {
  get_expiring_contracts: expiring,
  // The tool as it answered in production before the fix: the defect this guard must survive.
  get_solicitation_incumbent: preFixIncumbent,
  get_award_detail: award,
};

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_LEDGER_SECRET'] as const;
const savedEnv: Record<string, string | undefined> = {};
let plannerTools: Array<{ name: string; args: unknown }> = [];
let plannerCalls = 0;
const calls: Array<{ kind: 'planner' | 'answer'; body: Record<string, unknown> }> = [];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  process.env.CHAT_LEDGER_SECRET = 'test-ledger-secret';
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({ result: TOOL_RESULTS[name] ?? { ok: true }, credits: 0 }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    const kind = isPlannerCall(body) ? 'planner' : 'answer';
    calls.push({ kind, body });
    if (kind === 'planner') return plannerResponse(plannerCalls++ === 0 ? plannerTools : []);
    return answerStream(['Here is what the records show.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Turn = { role: 'user' | 'assistant'; content: string; sources?: unknown };
const history: Turn[] = [];

async function turn(message: string, tools: Array<{ name: string; args: unknown }>): Promise<{ ev: SseEvent[]; planner: string; answer: string }> {
  plannerTools = tools;
  plannerCalls = 0;
  calls.length = 0;
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(chatRequest({ message, history: [...history] }) as any);
  const ev = await withinMs(readSse(res), 5000, 'chat stream');
  const text = (kind: 'planner' | 'answer') => calls.filter((c) => c.kind === kind)
    .flatMap((c) => (c.body.messages as Array<{ content: unknown }>).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))).join('\n');
  history.push({ role: 'user', content: message }, { role: 'assistant', content: answerText(ev), sources: (ev.find((e) => e.type === 'sources') as { ledger?: unknown } | undefined)?.ledger });
  return { ev, planner: text('planner'), answer: text('answer') };
}

describe('36C24825C0020: one connected five-turn conversation', () => {
  it('keeps the contract\'s verified facts across turns, blocks pursuit on substituted facts, reports the profile, and never re-asks', async () => {
    history.length = 0;

    // 1. The renewal list. The contract is shown as an award; nothing to guard yet.
    const t1 = await turn('Which VA hospital construction contracts in Florida are coming up for renewal?', [{ name: 'get_expiring_contracts', args: { naics: '236220', state: 'FL' } }]);
    const ledger = JSON.stringify(history[1].sources);
    expect(ledger).toContain(ID);
    expect(t1.answer).not.toContain('CONTRACT EVIDENCE');

    // 2. "Is that exact contract worth pursuing?" The planner repeats the production mistake (a contract number to
    //    the solicitation tool) and the tool returns the captured pre-fix answer naming Daniels.
    const t2 = await turn(`Is contract ${ID} worth pursuing for us?`, [{ name: 'get_solicitation_incumbent', args: { solicitation_number: ID } }]);
    expect(t2.planner).toContain('CONTRACT IDENTITY');
    expect(t2.planner).toContain(`call get_award_detail with piid "${ID}"`);
    expect(t2.answer).toContain(`NOT ABOUT ${ID}: get_solicitation_incumbent returned solicitation 36C24824R0177 and award 36C77624C0154 (DANIELS BUILDING CO INC)`);
    expect(t2.answer).toContain(`PURSUIT BLOCKED for ${ID}`);
    expect(t2.answer).not.toMatch(/VERIFIED by get_solicitation_incumbent/);
    expect(t2.ev.some((e) => e.type === 'error')).toBe(false);

    // 3. "Who holds it and when does it end?" No id typed: the conversation's contract is still the subject.
    const t3 = await turn('Who holds it and when does it end?', [{ name: 'get_award_detail', args: { piid: ID } }]);
    expect(t3.answer).toContain(`${ID} VERIFIED by get_award_detail: holder BLUE CORD DESIGN AND CONSTRUCTION, LLC, $8,442,784 obligated, ends 2026-11-23.`);
    expect(t3.answer).not.toContain('PURSUIT BLOCKED');
    expect(t3.answer).not.toMatch(/DANIELS[^\n]*VERIFIED/);

    // 4. "Give me a pursuit plan" while the saved company profile cannot be read: said so, never treated as empty.
    h.profileResult.mockResolvedValueOnce({ status: 'unavailable', profile: {}, error: 'timeout' });
    const t4 = await turn('OK, give me a pursuit plan for it.', [{ name: 'get_award_detail', args: { piid: ID } }]);
    expect(t4.answer).toContain('COMPANY PROFILE UNAVAILABLE this turn');
    expect(t4.answer).toContain('do not ask the customer to re-enter details they already gave');
    expect(t4.answer).toContain(`${ID} VERIFIED by get_award_detail`);
    expect(t4.answer).not.toContain('PURSUIT BLOCKED');

    // 5. "What should we do next?" A suggested next step that repeats an earlier question is dropped.
    await turn('What should we do next?', []);
    h.callLLM.mockResolvedValueOnce({ text: JSON.stringify({ suggestions: [
      `Is contract ${ID} worth pursuing for us?`,
      'Draft an email to the VA Network Contracting Office 8',
      'Check the SDVOSB set-aside rules',
    ] }) });
    const { POST: suggest } = await import('./suggestions/route');
    const earlier = history.filter((x) => x.role === 'user').slice(0, -1).map((x) => x.content);
    const res = await suggest(new Request('http://localhost/api/app/chat/suggestions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'erika@example.com', message: 'What should we do next?', answer: 'Blue Cord Design and Construction holds 36C24825C0020 through 2026-11-23; the VA Network Contracting Office 8 awarded it.', earlier }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    const { suggestions } = await res.json() as { suggestions: string[] };
    expect(suggestions).toEqual(['Draft an email to the VA Network Contracting Office 8', 'Check the SDVOSB set-aside rules']);
    const llmUser = String((h.callLLM.mock.calls[0][0] as { user: string }).user);
    expect(llmUser).toContain(`Is contract ${ID} worth pursuing for us?`);
    expect(llmUser).toContain('Never suggest asking for, or re-asking, something the user already said');
  });
});
