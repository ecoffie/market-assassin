/**
 * Production retest 2026-11-27: figures that ARE in the attached file ("$35 billion+") came back "not established":
 * the figure check's evidence and its rewrite step left the attachments out. A figure the file states is sourced to
 * it; a figure in neither the tools nor the file is still not established.
 *
 * (Harness from research-mode-attachments.route.unit.test.ts.) Earlier record — P0 (production dry run 2026-11-27): research mode never saw attached files. An EFS capability statement produced a
 * report on the saved profile's company; Drive/OneDrive files read as "no file attached". These tests drive a research
 * turn through the real route with a session upload / a verified connected file and assert the model input carries
 * the fenced file text in the PER-TURN system part (never the cached prefix), with the attachment-over-profile rule.
 * Fix: #2553 (researchSystemDynamic attachments). These are the route-level proofs, plus the upload-citation rule and
 * QUESTION_OVER_PROFILE covering attachments in both engines.
 *
 * (Harness below copied from ask-mindy-research-mode.route.unit.test.ts.)
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
  docs: [] as Array<Record<string, unknown>>,
}));

const SID_H = '0b0b0b0b-1111-4222-8333-444444444444';
vi.mock('@/lib/vault/chat-store', async (orig) => ({
  ...(await orig<object>()),
  loadChatDocumentTexts: async () => ({ ok: true, value: h.docs }),
}));
vi.mock('@/lib/connected-apps/store', async (orig) => ({
  ...(await orig<object>()),
  accessTokenFor: async () => ({ ok: true, token: 'at', provider: 'microsoft', connection: { id: 'conn-1', provider: 'microsoft', connected_email: 'erika@example.com', display_name: null, granted_scopes: [], status: 'connected', created_at: '' } }),
}));
vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'in', 'order', 'limit', 'update', 'upsert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
  chain.insert = vi.fn((row: unknown) => { for (const r of Array.isArray(row) ? row : [row]) h.inserts.push(r as Record<string, unknown>); return chain; });
  let eqVal: unknown = null;
  chain.eq = vi.fn((_k: string, v: unknown) => { eqVal = v; return chain; });
  chain.maybeSingle = vi.fn(async () => (eqVal === SID_H ? { data: { id: SID_H, user_email: 'erika@example.com', message_count: 2 }, error: null } : { data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => ({}), loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => 'Company: Acme Clean (saved profile)' }));
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
const openaiSystems: string[] = [];
const EMAIL = 'erika@example.com';
const Q = 'Give me a full assessment of Ridgeline Digital.';
type Block = Record<string, unknown>;
const reply = (content: Block[], stop: string) => ({ content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 50 } });

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  for (const k of ENV_KEYS.slice(2)) delete process.env[k];
  openaiCalls.length = 0; openaiTools.length = 0; openaiSystems.length = 0; h.inserts.length = 0; h.overBudget = false; h.capUsed = 0; h.afterFns.length = 0; h.genOpts = null;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({ result: { ok: true, grounded: true, tool: name, note: 'obligated $1.2M' }, credits: 0 }));
  h.docs = [];
  h.runGate.mockReset(); h.extract.mockReset(); h.extract.mockImplementation(async () => 'digital marketing');
  h.create.mockReset();
  let step = 0;
  h.create.mockImplementation(async () => (++step === 1
    ? reply([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'find_opportunities', input: { query: 'digital marketing' } }, { type: 'tool_use', id: 'tu2', name: 'search_contractors', input: { keyword: 'Ridgeline' } }], 'tool_use')
    : reply([{ type: 'text', text: 'Start with the Navy recruiting campaign ($1.2M awarded so far).' }], 'end_turn')));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).startsWith('https://graph.microsoft.com/')) {
      if (String(url).endsWith('/content')) return new Response(DRIVE_TEXT);
      return new Response(JSON.stringify({ id: 'item-1', name: 'EFS Capability Statement.txt', size: DRIVE_TEXT.length, file: { mimeType: 'text/plain' }, webUrl: 'https://onedrive.live.com/x', lastModifiedDateTime: '2026-11-20T00:00:00Z' }));
    }
    openaiCalls.push(String(url));
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    for (const t of ((body.tools as Array<{ function?: { name?: string } }>) || [])) openaiTools.push(String(t.function?.name));
    for (const m of ((body.messages as Array<{ role?: string; content?: unknown }>) || [])) if (m.role === 'system') openaiSystems.push(String(m.content));
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

async function ask(message: string, extra: Record<string, unknown> = {}): Promise<SseEvent[]> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withinMs(readSse(await POST(chatRequest({ message, email: EMAIL, sessionId: SID_H, ...extra }) as any)), 5000, 'chat stream');
}
const text = (ev: SseEvent[]) => ev.filter((e) => e.type === 'token').map((e) => (e as { content: string }).content).join('');
const flagOn = () => { process.env.ASK_MINDY_RESEARCH_MODE = 'true'; process.env.ASK_MINDY_RESEARCH_MODE_ALLOWLIST = EMAIL; };
const savedTrace = async () => { await new Promise((r) => setTimeout(r, 20)); return (h.inserts.find((r) => r.role === 'assistant') as { trace?: Record<string, unknown> } | undefined)?.trace; };



const FILE_TEXT = 'Northwind Federal Partners (synthetic). Capability statement. We have funded $35 billion+ in federal programs. Current contract ends September 30, 2027.';
const upload = () => ({ id: 'd1', filename: 'Northwind Capability Statement.pdf', mime_type: 'application/pdf', size_bytes: 1000, page_count: 2, char_count: FILE_TEXT.length, text_truncated: false, created_at: '2026-11-27T00:00:00Z', extracted_text: FILE_TEXT });
const answerWith = (t: string) => {
  let step = 0;
  h.create.mockImplementation(async (body: { messages?: Array<{ content?: unknown }> }) => {
    step++;
    if (step === 1) return reply([{ type: 'tool_use', id: 'tu1', name: 'find_opportunities', input: { query: 'program funding' } }], 'tool_use');
    if (step === 2) return reply([{ type: 'text', text: t }], 'end_turn');
    // The figure-check rewrite: echo the answer without the untraceable figure.
    void body;
    return reply([{ type: 'text', text: 'Northwind states it has funded $35 billion+ (from its capability statement). Its other figure is not established.' }], 'end_turn');
  });
};

describe('a figure stated in the attached file is sourced to it, never "not established"', () => {
  it('an attached-file figure and date pass the figure check untouched: no rewrite, no disclosure', async () => {
    flagOn();
    process.env.VAULT_ASK_MINDY_UPLOADS = 'true';
    h.docs = [upload()];
    const ANSWER = 'Northwind states it has funded $35 billion+ (from its capability statement); its current contract ends September 30, 2027.';
    answerWith(ANSWER);
    const ev = await ask('What does this company do?');
    expect(text(ev)).toBe(ANSWER);
    expect(h.create).toHaveBeenCalledTimes(2); // no rewrite step
    expect(await savedTrace()).toMatchObject({ figure_check: { untraceable: [], revised: false, disclosed: false } });
    delete process.env.VAULT_ASK_MINDY_UPLOADS;
  });

  it('a figure in neither the tools nor the file is still flagged, and the rewrite step sees the file and the attribution rule', async () => {
    flagOn();
    process.env.VAULT_ASK_MINDY_UPLOADS = 'true';
    h.docs = [upload()];
    answerWith('Northwind states it has funded $35 billion+ (from its capability statement) and won $9.7M last year.');
    const ev = await ask('What does this company do?');
    expect(h.create).toHaveBeenCalledTimes(3);
    const rewrite = h.create.mock.calls[2][0] as { system: string; messages: Array<{ content: string }> };
    expect(rewrite.messages[0].content).toContain('$9.7M');
    expect(rewrite.messages[0].content).not.toMatch(/\$35 billion\+,|: \$35 billion\+/); // the file's figure is not flagged
    expect(rewrite.messages[0].content).toMatch(/attached file/);
    expect(String(rewrite.system)).toContain('We have funded $35 billion+');
    expect(String(rewrite.system)).toContain('FACTS FROM AN ATTACHED FILE ARE SOURCED');
    expect(text(ev)).toContain('Northwind states it has funded $35 billion+');
    expect(await savedTrace()).toMatchObject({ figure_check: { untraceable: ['$9.7M'], revised: true, disclosed: false } });
    delete process.env.VAULT_ASK_MINDY_UPLOADS;
  });

  it('the research model is told to attribute file facts (per-turn part)', async () => {
    flagOn();
    process.env.VAULT_ASK_MINDY_UPLOADS = 'true';
    h.docs = [upload()];
    answerWith('Northwind states it has funded $35 billion+ (from its capability statement).');
    await ask('What does this company do?');
    const dyn = (h.create.mock.calls[0][0] as { system: Array<{ text: string }> }).system[1].text;
    expect(dyn).toContain('FACTS FROM AN ATTACHED FILE ARE SOURCED');
    expect(dyn).toContain('never "not established"');
    delete process.env.VAULT_ASK_MINDY_UPLOADS;
  });
});
