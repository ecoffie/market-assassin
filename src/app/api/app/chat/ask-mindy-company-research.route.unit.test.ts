/**
 * Ask Mindy company research through the real route (ASK_MINDY_COMPANY_RESEARCH, default off). Synthetic names.
 * Harness copied from ask-mindy-intelligence-gate.route.unit.test.ts.
 * (Gate notes below kept from the copied harness:)
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
  clues: vi.fn(),
  sam: vi.fn(),
  answerSystems: [] as string[][],
  plannerSystems: [] as string[][],
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

vi.mock('@/lib/ask-mindy/company-research', async (orig) => ({ ...(await orig<typeof import('@/lib/ask-mindy/company-research')>()), extractCompanyClues: h.clues, proposeWebCandidates: vi.fn(async () => []) }));
vi.mock('@/mcp/tools/sam-entity', async (orig) => ({ ...(await orig<typeof import('@/mcp/tools/sam-entity')>()), lookupSamEntity: h.sam }));

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ASK_MINDY_INTELLIGENCE_GATE', 'ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST', 'ASK_MINDY_COMPANY_RESEARCH', 'ASK_MINDY_COMPANY_RESEARCH_ALLOWLIST', 'SERPER_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
const calls: Array<{ kind: 'planner' | 'answer' }> = [];
const EMAIL = 'erika@example.com';
const Q = 'What should Ridgeline Digital go after?';
const clue = (names: string[], over: Record<string, unknown> = {}) => ({ isCompanyRequest: names.length > 0, companyNames: names, personNames: [], website: null, city: null, state: null, uei: null, cage: null, ...over });
const ent = (uei: string, legal: string, city: string, st: string) => ({ ueiSAM: uei, cageCode: '1AB23', legalBusinessName: legal, registrationStatus: 'Active', isActive: true, physicalAddress: { city, stateOrProvince: st } });

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  calls.length = 0; h.inserts.length = 0; h.answerSystems.length = 0; h.plannerSystems.length = 0;
  h.runMcpTool.mockReset(); h.runMcpTool.mockImplementation(async () => ({ result: { ok: true }, credits: 0 }));
  h.runGate.mockReset(); h.extract.mockReset(); h.extract.mockImplementation(async () => null);
  h.clues.mockReset(); h.clues.mockImplementation(async () => clue(['Ridgeline Digital']));
  h.sam.mockReset(); h.sam.mockImplementation(async () => ({ entity: null, matches: [ent('AAA000000001', 'Ridgeline Digital LLC', 'Norfolk', 'VA')] }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as { messages?: Array<{ role: string; content: unknown }> };
    const kind = isPlannerCall(body as Record<string, unknown>) ? 'planner' : 'answer';
    calls.push({ kind });
    const sys = (body.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content));
    (kind === 'planner' ? h.plannerSystems : h.answerSystems).push(sys);
    return kind === 'planner' ? plannerResponse([]) : answerStream(['Existing path answer.']);
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
const flagOn = () => { process.env.ASK_MINDY_COMPANY_RESEARCH = 'true'; process.env.ASK_MINDY_COMPANY_RESEARCH_ALLOWLIST = EMAIL; };

describe('company research in the chat route', () => {
  it('flag off: nothing changes (no clue extraction, no SAM lookup)', async () => {
    const ev = await ask(Q);
    expect(h.clues).not.toHaveBeenCalled();
    expect(h.sam).not.toHaveBeenCalled();
    expect(text(ev)).toContain('Existing path answer.');
  });

  it('flag on, one matching registration: the answer and the planner both get the identity with its evidence', async () => {
    flagOn();
    h.clues.mockImplementation(async () => clue(['Ridgeline Digital'], { state: 'VA' }));
    const ev = await ask(Q);
    expect(h.sam).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ridgeline Digital' }));
    expect(ev.some((e) => e.type === 'progress')).toBe(true);
    const ans = h.answerSystems[0].join('\n');
    expect(ans).toContain('IDENTITY (LIKELY): Ridgeline Digital LLC');
    expect(ans).toContain('SAM UEI AAA000000001');
    expect(ans).toMatch(/Web search is NOT configured/);
    expect(h.plannerSystems[0].join('\n')).toContain('SAM UEI AAA000000001');
    await new Promise((r) => setTimeout(r, 20));
    const assistant = h.inserts.find((r) => r.role === 'assistant') as { trace?: Record<string, unknown> } | undefined;
    expect(assistant?.trace).toMatchObject({ company_research: { status: 'likely', uei: 'AAA000000001', web_status: 'not_configured' } });
  });

  it('flag on, two same-name registrations: ONE question listing both, and no answer model runs', async () => {
    flagOn();
    h.sam.mockImplementation(async () => ({ entity: null, matches: [ent('AAA000000001', 'Ridgeline Digital LLC', 'Norfolk', 'VA'), ent('BBB000000002', 'Ridgeline Digital Inc', 'Austin', 'TX')] }));
    const ev = await ask(Q);
    const t = text(ev);
    expect(t).toContain('Ridgeline Digital LLC, Norfolk, VA');
    expect(t).toContain('Ridgeline Digital Inc, Austin, TX');
    expect(t).toMatch(/Which one do you mean\?/);
    expect(calls).toHaveLength(0);
    expect(ev[ev.length - 1].type).toBe('done');
    await new Promise((r) => setTimeout(r, 20));
    const assistant = h.inserts.find((r) => r.role === 'assistant') as { trace?: Record<string, unknown> } | undefined;
    expect(assistant?.trace).toMatchObject({ engine: 'company_research', company_research: { status: 'ambiguous', candidates: ['AAA000000001', 'BBB000000002'] } });
  });

  it('flag on, no registration: the answer is told no federal registration was found, with no UEI', async () => {
    flagOn();
    h.sam.mockImplementation(async () => ({ entity: null, matches: [] }));
    await ask(Q);
    const ans = h.answerSystems[0].join('\n');
    expect(ans).toContain('NO FEDERAL REGISTRATION FOUND');
    expect(ans).not.toMatch(/SAM UEI [A-Z0-9]{12}/);
  });

  it('flag on, not about a company: unchanged', async () => {
    flagOn();
    h.clues.mockImplementation(async () => clue([]));
    await ask('What janitorial work is open in Florida?');
    expect(h.sam).not.toHaveBeenCalled();
    expect(h.answerSystems[0].join('\n')).not.toContain('COMPANY RESEARCH');
  });

  it('flag on, the identity step fails: the customer still gets the existing answer', async () => {
    flagOn();
    h.clues.mockImplementation(async () => { throw new Error('model down'); });
    const ev = await ask(Q);
    expect(text(ev)).toContain('Existing path answer.');
  });

  it('a company turn does not also run the intelligence gate', async () => {
    flagOn();
    process.env.ASK_MINDY_INTELLIGENCE_GATE = 'true'; process.env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST = EMAIL;
    h.extract.mockImplementation(async () => 'digital services');
    await ask('What open opportunities are there for Ridgeline Digital in Virginia?');
    expect(h.runGate).not.toHaveBeenCalled();
  });
});
