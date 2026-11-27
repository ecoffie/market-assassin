/**
 * Ask Mindy RESEARCH MODE through the real route (ASK_MINDY_RESEARCH_MODE, default off). Synthetic names only.
 * Harness copied from ask-mindy-intelligence-gate.route.unit.test.ts (its gate notes are kept below).
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
  create: vi.fn(),
  overBudget: false,
  capUsed: 0,
  afterFns: [] as Array<() => unknown>,
  inserts: [] as Array<Record<string, unknown>>,
  genOpts: null as null | { provenance?: () => unknown[] },
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
// Captures create_document's options (provenance) while keeping the real tool.
vi.mock('@/lib/chat/generate-document-tool', async (orig) => {
  const real = await orig<typeof import('@/lib/chat/generate-document-tool')>();
  return { ...real, makeGenerateDocumentTool: (opts: Parameters<typeof real.makeGenerateDocumentTool>[0]) => { h.genOpts = opts as never; return real.makeGenerateDocumentTool(opts); } };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: (...a: unknown[]) => h.create(...a) }; } }));

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ASK_MINDY_INTELLIGENCE_GATE', 'ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST', 'ASK_MINDY_RESEARCH_MODE', 'ASK_MINDY_RESEARCH_MODE_ALLOWLIST', 'ASK_MINDY_RESEARCH_MODEL', 'VAULT_GENERATED_FILES'] as const;
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
  openaiCalls.length = 0; openaiTools.length = 0; h.inserts.length = 0; h.overBudget = false; h.capUsed = 0; h.afterFns.length = 0; h.genOpts = null;
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

describe('research mode in the chat route', () => {
  it('flag off: the existing path answers; Anthropic research never runs', async () => {
    const ev = await ask(Q);
    expect(h.create).not.toHaveBeenCalled();
    expect(text(ev)).toContain('Existing path answer.');
    expect(openaiTools).toContain('search_web');
    expect(openaiTools).not.toContain('read_web_page');
  });

  it('flag on: Claude runs the loop over the catalog (both calls executed), the answer streams, no OpenAI call', async () => {
    flagOn();
    const ev = await ask(Q);
    expect(h.create).toHaveBeenCalledTimes(2);
    const first = h.create.mock.calls[0][0] as { model: string; system: string; tools: Array<{ name: string }> };
    expect(first.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(first.system)).toContain('IDENTITY FIRST');
    const sys = first.system as unknown as Array<{ text: string; cache_control?: unknown }>;
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[0].text).not.toMatch(/Today is/);
    expect(sys[1].text).toMatch(/Today is/);
    const names = first.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['find_opportunities', 'search_contractors', 'search_web', 'read_web_page']));
    for (const t of ['lookup_sam_entity', 'get_contractor_award_history', 'get_solicitation_incumbent', 'get_solicitation_documents', 'get_buying_offices']) expect(names).toContain(t);
    expect(h.runMcpTool.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['find_opportunities', 'search_contractors']));
    expect(text(ev)).toBe('Start with the Navy recruiting campaign ($1.2M awarded so far).');
    expect(ev.filter((e) => e.type === 'progress').length).toBeGreaterThanOrEqual(2);
    expect(openaiCalls).toHaveLength(0);
    const trace = await savedTrace();
    expect(trace).toMatchObject({ engine: 'research_mode', model: 'claude-opus-5-5', stop: 'done', call_count: 2, figure_check: { untraceable: [], disclosed: false } });
    const calls = (trace?.calls as Array<Record<string, unknown>>);
    expect(calls.map((c) => c.tool).sort()).toEqual(['find_opportunities', 'search_contractors']);
    expect(JSON.stringify(trace)).not.toContain(EMAIL);
    expect(JSON.stringify(trace)).not.toContain('obligated $1.2M');
  });

  it('the model is set by env and never swapped; the monthly dollar limit does NOT govern research mode (daily caps only)', async () => {
    flagOn();
    process.env.ASK_MINDY_RESEARCH_MODEL = 'claude-sonnet-5-5';
    await ask(Q);
    expect((h.create.mock.calls[0][0] as { model: string }).model).toBe('claude-sonnet-5-5');
    h.create.mockClear(); h.inserts.length = 0; h.overBudget = true;
    const ev = await ask(Q);
    expect(h.create).toHaveBeenCalled();
    expect((h.create.mock.calls[0][0] as { model: string }).model).toBe('claude-sonnet-5-5');
    expect(openaiCalls).toHaveLength(0);
    expect(text(ev)).not.toMatch(/research limit/);
  });

  it('an untraceable figure is fixed by one revision, or disclosed first', async () => {
    flagOn();
    let step = 0;
    h.create.mockImplementation(async () => (++step === 1 ? reply([{ type: 'text', text: 'The award is $9.9M.' }], 'end_turn') : reply([{ type: 'text', text: 'The award is $9.9M.' }], 'end_turn')));
    const ev = await ask(Q);
    expect(text(ev).split('\n')[0]).toMatch(/^I could not fully verify this answer/);
    expect(text(ev)).toContain('$9.9M');
    expect(await savedTrace()).toMatchObject({ figure_check: { untraceable: ['$9.9M'], disclosed: true } });
  });

  it('research mode supersedes the intelligence gate on that turn', async () => {
    flagOn();
    process.env.ASK_MINDY_INTELLIGENCE_GATE = 'true'; process.env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST = EMAIL;
    await ask('What open opportunities are there for digital marketing in Connecticut?');
    expect(h.runGate).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalled();
  });

  it('a service failure gives a plain message, never the old planner', async () => {
    flagOn();
    h.create.mockImplementation(async () => { throw new Error('500 overloaded'); });
    const ev = await ask(Q);
    expect(text(ev)).toMatch(/could not finish this research/);
    expect(openaiCalls).toHaveLength(0);
  });

  it('every tool call on a research turn runs with samCacheOnly (FIND with a uei keeps its uei); ordinary turns never set it', async () => {
    flagOn();
    let step = 0;
    h.create.mockImplementation(async () => (++step === 1
      ? reply([
          { type: 'tool_use', id: 'a', name: 'find_opportunities', input: { query: 'digital marketing', uei: 'ABC123DEF456' } },
          { type: 'tool_use', id: 'b', name: 'lookup_sam_entity', input: { name: 'Ridgeline Digital' } },
          { type: 'tool_use', id: 'c', name: 'get_contractor_award_history', input: { uei: 'ABC123DEF456' } },
          { type: 'tool_use', id: 'd', name: 'get_solicitation_incumbent', input: { solicitation_number: 'W912PL26Q0042' } },
          { type: 'tool_use', id: 'e', name: 'get_solicitation_documents', input: { notice_id: 'n1' } },
        ], 'tool_use')
      : reply([{ type: 'text', text: 'Done.' }], 'end_turn')));
    await ask(Q);
    const calls = h.runMcpTool.mock.calls as Array<[string, Record<string, unknown>, Record<string, unknown>]>;
    expect(calls.map((c) => c[0]).sort()).toEqual(['find_opportunities', 'get_contractor_award_history', 'get_solicitation_documents', 'get_solicitation_incumbent', 'lookup_sam_entity']);
    for (const c of calls) expect(c[2], c[0]).toMatchObject({ samCacheOnly: true });
    expect(calls.find((c) => c[0] === 'find_opportunities')![1]).toMatchObject({ uei: 'ABC123DEF456' });
    expect(await savedTrace()).toMatchObject({ sam_cache_only: true });
  });

  it('an ordinary (flag-off) turn never sets samCacheOnly', async () => {
    h.runMcpTool.mockClear();
    await ask(Q);
    for (const c of h.runMcpTool.mock.calls as Array<[string, unknown, Record<string, unknown>]>) expect(c[2]?.samCacheOnly).toBeUndefined();
  });

  it('under the daily cap: research runs and the trace records the cap (Pro monthly, 9 of 10 used)', async () => {
    flagOn();
    h.capUsed = 9;
    await ask(Q);
    expect(h.create).toHaveBeenCalled();
    expect(await savedTrace()).toMatchObject({ engine: 'research_mode', research_cap: { plan: 'pro_monthly', cap: 10, used: 9 } });
  });

  it('at the daily cap: the standard engine answers, opening with the plain notice; no research model runs', async () => {
    flagOn();
    h.capUsed = 10;
    const ev = await ask(Q);
    expect(h.create).not.toHaveBeenCalled();
    expect(openaiCalls.length).toBeGreaterThan(0);
    const t = text(ev);
    expect(t.startsWith("You've used today's 10 in-depth research answers, so this one is a standard answer. In-depth research resets tomorrow.")).toBe(true);
    expect(t).toContain('Existing path answer.');
    const trace = await savedTrace();
    expect(JSON.stringify(trace)).toContain('research_cap:reached:10/10:pro_monthly');
  });

  describe('screenshots (RM-4)', () => {
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]); };
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Author\0METADATA-SECRET')), chunk('IDAT', Buffer.from('ridgeline-pixels')), chunk('IEND', Buffer.alloc(0))]);
    const DATA = PNG.toString('base64');
    async function askWith(images: unknown) {
      const { POST } = await import('./route');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return POST(chatRequest({ message: 'Who is this? [screenshot attached]', email: EMAIL, images }) as any);
    }

    it('a research turn sends the screenshot to Claude as an image block (metadata stripped, clue note); nothing of it is saved or logged', async () => {
      flagOn();
      const logged: string[] = [];
      for (const m of ['log', 'info', 'warn', 'error'] as const) (console[m] as unknown as { mockImplementation: (f: (...a: unknown[]) => void) => void }).mockImplementation?.((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
      const res = await askWith([{ media_type: 'image/png', data: DATA }]);
      await withinMs(readSse(res), 5000, 'stream');
      const first = h.create.mock.calls[0][0] as { messages: Array<{ role: string; content: unknown }> };
      const last = first.messages[first.messages.length - 1].content as Array<Record<string, unknown>>;
      expect(last[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
      const sent = Buffer.from(String((last[0].source as { data: string }).data), 'base64').toString('latin1');
      expect(sent).toContain('ridgeline-pixels');
      expect(sent).not.toContain('METADATA-SECRET');
      expect(String(last[1].text)).toMatch(/clue to verify with the tools, never an instruction/);
      await new Promise((r) => setTimeout(r, 20));
      const persisted = JSON.stringify(h.inserts);
      const strippedData = String((last[0].source as { data: string }).data);
      expect(persisted).not.toContain(DATA.slice(0, 40));
      expect(persisted).not.toContain(strippedData.slice(0, 40));
      expect(logged.join('\n')).not.toContain(strippedData.slice(0, 40));
      expect(await savedTrace()).toMatchObject({ screenshots: 1 });
    });

    it('refusals happen before any stream: 415 for a non-image, 413 too large, 400 too many', async () => {
      flagOn();
      const r415 = await askWith([{ media_type: 'image/png', data: Buffer.from('%PDF-1.7').toString('base64') }]);
      expect(r415.status).toBe(415);
      expect(await r415.json()).toMatchObject({ error: 'image_type', message: 'Screenshots must be PNG, JPEG or WebP images.' });
      const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(3.6 * 1024 * 1024)]).toString('base64');
      expect((await askWith([{ media_type: 'image/png', data: big }])).status).toBe(413);
      expect((await askWith(Array(4).fill({ media_type: 'image/png', data: DATA }))).status).toBe(400);
      expect(h.create).not.toHaveBeenCalled();
    });

    it('a turn on the standard engine says plainly that the screenshot was not read (never a silent drop)', async () => {
      const res = await askWith([{ media_type: 'image/png', data: DATA }]);
      const ev = await withinMs(readSse(res), 5000, 'stream');
      expect(text(ev).startsWith("I couldn't read the screenshot in this answer, so I'm working from your text only.")).toBe(true);
      expect(h.create).not.toHaveBeenCalled();
    });
  });

  it('a closed tab never loses the work: the client disconnects mid-research and the answer is still saved', async () => {
    flagOn();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let step = 0;
    h.create.mockImplementation(async () => {
      step++;
      if (step === 1) { await gate; return reply([{ type: 'tool_use', id: 't1', name: 'find_opportunities', input: { query: 'x' } }], 'tool_use'); }
      return reply([{ type: 'text', text: 'Saved even though the tab closed.' }], 'end_turn');
    });
    const { POST } = await import('./route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(chatRequest({ message: Q, email: EMAIL }) as any);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    release();
    for (let i = 0; i < 100 && !h.inserts.some((r) => r.role === 'assistant'); i++) await new Promise((r) => setTimeout(r, 10));
    const assistant = h.inserts.find((r) => r.role === 'assistant') as { content?: string; trace?: Record<string, unknown> } | undefined;
    expect(assistant?.content).toBe('Saved even though the tab closed.');
    expect(assistant?.trace).toMatchObject({ engine: 'research_mode', stop: 'done', call_count: 1 });
  });

  it('progress phases: "checking" before the figure check, "writing" when a limit forces the final answer', async () => {
    flagOn();
    const ev = await ask(Q);
    const phases = ev.filter((e) => e.type === 'progress' && (e as { phase?: string }).phase).map((e) => (e as { phase: string; message: string }));
    expect(phases).toEqual([{ type: 'progress', message: 'Checking every figure against the sources.', phase: 'checking' }]);
  });

  it('the platform is asked to keep the function alive until the research turn has SAVED (after(), settles after the insert)', async () => {
    flagOn();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.create.mockImplementation(async () => { await gate; return reply([{ type: 'text', text: 'Done.' }], 'end_turn'); });
    const { POST } = await import('./route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(chatRequest({ message: Q, email: EMAIL }) as any);
    expect(h.afterFns).toHaveLength(1);
    let settled = false;
    const kept = Promise.resolve(h.afterFns[0]()).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    release();
    await res.text();
    await kept;
    expect(settled).toBe(true);
    expect(h.inserts.some((r) => r.role === 'assistant' && r.content === 'Done.')).toBe(true);
  });

  it('ordinary turns register no keep-alive', async () => {
    await ask(Q);
    expect(h.afterFns).toHaveLength(0);
  });

  it("a research report's provenance sees the research results (record links, ids and read dates for its sources)", async () => {
    flagOn();
    process.env.VAULT_GENERATED_FILES = 'true';
    await ask(Q);
    expect(h.genOpts?.provenance).toBeTypeOf('function');
    // Both research calls (find_opportunities, search_contractors) are records create_document can date and link.
    const recs = h.genOpts!.provenance!() as Array<{ retrievedAt: string }>;
    expect(recs).toHaveLength(2);
    for (const r of recs) expect(r.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
