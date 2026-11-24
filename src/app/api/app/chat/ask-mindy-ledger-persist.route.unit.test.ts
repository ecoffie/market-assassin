/**
 * The chat route stores the signed source ledger it sent the client on the assistant row's trace
 * (ASK_MINDY_RECIPES, default off), and NEVER a tool result body: the migration that added the trace column
 * (20261114_ask_mindy_execution_trace) states no tool result bodies are stored there, and this asserts it for
 * the ledger path explicitly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({ runMcpTool: vi.fn(), inserts: [] as Array<{ table: string; rows: unknown }> }));

vi.mock('@supabase/supabase-js', () => {
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
    chain.insert = vi.fn((rows: unknown) => { h.inserts.push({ table, rows }); return chain; });
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    chain.single = vi.fn(async () => ({ data: null, error: null }));
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return chain;
  };
  return { createClient: () => ({ from: (t: string) => make(t), storage: { from: () => ({}) } }) };
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

/** A marker that appears ONLY in tool result bodies (never a key or a label). */
const BODY_MARKER = 'BODYMARKER-7f3a9-full-statement-of-work-text';
const EXPIRING = {
  contracts: [{ contract_id: 'CONT_AWD_36C24825C0020_3600_-NONE-_-NONE-', piid: '36C24825C0020', incumbent_name: 'BLUE CORD DESIGN AND CONSTRUCTION, LLC', awarding_agency: 'Department of Veterans Affairs', place_of_performance_state: 'FL', period_of_performance_current_end: '2026-11-23', total_obligation: 8442784, description: `RENOVATE 5 WEST ${BODY_MARKER}` }],
  _meta: { grounded: true, degraded: false, result_state: 'results', ignored_args: [], total: 1, applied_filters: { naics: ['236220'] }, window: { as_of: '2026-11-22', months: 18 } },
};

const ENV_KEYS = ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CHAT_LEDGER_SECRET', 'ASK_MINDY_RECIPES', 'ASK_MINDY_RECIPES_ALLOWLIST'] as const;
const saved: Record<string, string | undefined> = {};
const EMAIL = 'erika@example.com';
let toolResult: unknown = EXPIRING;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  process.env.CHAT_LEDGER_SECRET = 'test-ledger-secret';
  delete process.env.ASK_MINDY_RECIPES; delete process.env.ASK_MINDY_RECIPES_ALLOWLIST;
  h.inserts.length = 0;
  toolResult = EXPIRING;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async () => ({ result: toolResult, credits: 0 }));
  let plannerCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    if (isPlannerCall(body)) return plannerResponse(plannerCalls++ === 0 ? [{ name: 'get_expiring_contracts', args: { naics: '236220', state: 'FL' } }] : []);
    return answerStream(['Here are the renewals.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function turn(): Promise<{ ev: SseEvent[]; assistantRow: Record<string, unknown> | undefined }> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = await withinMs(readSse(await POST(chatRequest({ message: 'Which VA construction contracts in Florida are coming up for renewal?', email: EMAIL, sessionId: '11111111-1111-4111-8111-111111111111' }) as any)), 5000, 'chat stream');
  for (let i = 0; i < 50 && !h.inserts.some((x) => x.table === 'mindy_chat_messages'); i++) await new Promise((r) => setTimeout(r, 10));
  const rows = (h.inserts.find((x) => x.table === 'mindy_chat_messages')?.rows ?? []) as Array<Record<string, unknown>>;
  return { ev, assistantRow: rows.find((r) => r.role === 'assistant') };
}
const sseLedger = (ev: SseEvent[]) => (ev.find((e) => e.type === 'sources') as { ledger?: unknown } | undefined)?.ledger;

describe('the signed ledger is persisted with the assistant turn (ASK_MINDY_RECIPES)', () => {
  it('flag on: trace.ledger is exactly the ledger the client received, signed', async () => {
    process.env.ASK_MINDY_RECIPES = 'allowlist'; process.env.ASK_MINDY_RECIPES_ALLOWLIST = EMAIL;
    const { ev, assistantRow } = await turn();
    const trace = assistantRow?.trace as { ledger?: { sig?: string; entries: Array<{ items?: Array<{ key: string }> }> } } | undefined;
    expect(trace?.ledger).toEqual(sseLedger(ev));
    expect(trace?.ledger?.sig).toBeTruthy();
    expect(JSON.stringify(trace?.ledger)).toContain('36C24825C0020');
  });

  it('no tool result body is ever written to the trace', async () => {
    process.env.ASK_MINDY_RECIPES = 'true';
    const { assistantRow } = await turn();
    expect(assistantRow?.trace).toBeTruthy();
    expect(JSON.stringify(assistantRow?.trace)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(assistantRow?.trace)).not.toContain('RENOVATE 5 WEST');
  });

  it('flag off: no ledger in the trace', async () => {
    const { assistantRow } = await turn();
    expect((assistantRow?.trace as { ledger?: unknown } | undefined)?.ledger).toBeUndefined();
  });

  it('a ledger over the cap is not stored, and the trace says why (cap itself: ledger-persistence.unit.test.ts)', async () => {
    process.env.ASK_MINDY_RECIPES = 'true';
    vi.resetModules();
    vi.doMock('@/lib/chat/ledger-persistence', async (orig) => ({
      ...(await orig<typeof import('@/lib/chat/ledger-persistence')>()),
      ledgerForTrace: () => ({ notice: 'ledger_not_persisted:too_large:20000' }),
    }));
    const { assistantRow } = await turn();
    vi.doUnmock('@/lib/chat/ledger-persistence');
    vi.resetModules();
    const trace = assistantRow?.trace as { ledger?: unknown; notices: string[] } | undefined;
    expect(trace?.ledger).toBeUndefined();
    expect(trace?.notices).toContain('ledger_not_persisted:too_large:20000');
  });
});
