/**
 * Ask Mindy on opportunity cards — the real /api/app/chat handler with services mocked.
 *
 * Pins, end to end through the route: the flag gate, free-vs-Pro access, the record loaded server-side
 * (never from the client), exactly one debit for a successful free card turn, no debit for failures or Pro,
 * and session ownership.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const NID = '6ba812a7e0284f79bc44c4932777c340';
const ME = 'free@example.com';

const state: {
  pro: boolean;
  balance: number | null; balanceError: boolean;
  record: Record<string, unknown> | null; recordError: boolean;
  sessions: Record<string, string>;
  answer: string; answerFails: boolean;
  plannerMessages: Array<Array<{ role: string; content: string }>>;
  answerMessages: Array<Array<{ role: string; content: string }>>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  allowedToolNames: unknown;
} = {} as never;

const debitCredits = vi.fn(async (_e: string, amount: number) => ({ ok: (state.balance ?? 0) >= amount, newBalance: (state.balance ?? 0) - amount }));

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => state.pro }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/mcp/credits', () => ({ debitCredits: (...a: [string, number]) => debitCredits(...a) }));
vi.mock('@/lib/chat/chat-tool-executor', () => ({
  createChatToolExecutor: (opts: { allowedToolNames?: unknown }) => {
    state.allowedToolNames = opts.allowedToolNames ?? null;
    return { offeredToolDefs: () => [], executeRound: async () => [], policyFor: () => ({ decision: 'allowed_read' }) };
  },
}));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));

function builder(table: string) {
  const q: Record<string, unknown> = {};
  let eqVal: unknown = null;
  q.select = () => q;
  q.eq = (_k: string, v: unknown) => { eqVal = v; return q; };
  q.update = () => ({ eq: async () => ({ error: null }) });
  q.insert = async (row: Record<string, unknown>) => { state.inserts.push({ table, row }); return { error: null }; };
  q.maybeSingle = async () => {
    if (table === 'mcp_credit_balance') return state.balanceError ? { data: null, error: { message: 'down' } } : { data: state.balance == null ? null : { balance: state.balance }, error: null };
    if (table === 'sam_opportunities') return state.recordError ? { data: null, error: { message: 'down' } } : { data: state.record, error: null };
    if (table === 'mindy_chat_sessions') { const owner = state.sessions[String(eqVal)]; return { data: owner ? { id: eqVal, user_email: owner, message_count: 2 } : null, error: null }; }
    return { data: null, error: null };
  };
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

function sseBody(text: string) {
  const enc = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}

beforeEach(() => {
  Object.assign(state, {
    pro: false, balance: 100, balanceError: false,
    record: {
      notice_id: NID, title: 'Janitorial Services, Building 12', solicitation_number: 'W912PL26Q0042', department: 'DEPT OF DEFENSE',
      sub_tier: 'DEPT OF THE ARMY', office: 'LA District', notice_type: 'Solicitation', set_aside_description: 'Total Small Business',
      naics_code: '561720', psc_code: 'S201', posted_date: '2026-11-01', response_deadline: '2026-12-04', pop_city: null, pop_state: 'CA',
      description: 'Provide janitorial services.', sow_text: null, ui_link: 'https://sam.gov/opp/x/view', active: true,
    },
    recordError: false, sessions: {}, answer: 'The response deadline is 2026-12-04 (SAM.gov notice W912PL26Q0042).', answerFails: false,
    plannerMessages: [], answerMessages: [], inserts: [], allowedToolNames: null,
  });
  debitCredits.mockClear();
  vi.stubEnv('MAP_CARD_CHAT_ENABLED', 'true');
  vi.stubEnv('GROQ_API_KEY', 'gk'); vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (b.stream) {
      state.answerMessages.push(b.messages);
      if (state.answerFails) return new Response('boom', { status: 500 });
      return new Response(sseBody(state.answer), { status: 200 });
    }
    state.plannerMessages.push(b.messages);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'no tools needed' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function post(body: Record<string, unknown>) {
  vi.resetModules();
  const { POST } = await import('./route');
  const req = new Request('https://getmindy.ai/api/app/chat', { method: 'POST', body: JSON.stringify({ email: ME, message: 'When is it due?', ...body }) });
  const res = await POST(req as never);
  const events: Array<Record<string, unknown>> = [];
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const text = await res.text();
    for (const block of text.split('\n\n')) { const l = block.split('\n').find((x) => x.startsWith('data:')); if (l) { try { events.push(JSON.parse(l.slice(5))); } catch { /* ignore */ } } }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { res, events };
}
const card = { context: { kind: 'opportunity', notice_id: NID } };

describe('access', () => {
  it('flag off: a free account with context is refused exactly as before (403 pro_required)', async () => {
    vi.stubEnv('MAP_CARD_CHAT_ENABLED', '');
    const { res } = await post(card);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'pro_required' });
    expect(debitCredits).not.toHaveBeenCalled();
  });
  it('free account without a card context: 403 pro_required (general chat stays Pro)', async () => {
    const { res } = await post({});
    expect(res.status).toBe(403);
  });
  it('free account with too few credits: 402 with balance and price, no model call', async () => {
    state.balance = 4;
    const { res } = await post(card);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'credits_required', balance: 4, credits_per_answer: 10 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('balance read failure: refused (unknown is never treated as credit)', async () => {
    state.balanceError = true;
    const { res } = await post(card);
    expect(res.status).toBe(402);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('unknown notice id: 404, no model call, no charge', async () => {
    state.record = null;
    const { res } = await post(card);
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('context comes from the server record, never the client', () => {
  it('the planner and the answer both receive the record block; client text is not a source', async () => {
    await post({ context: { kind: 'opportunity', notice_id: NID, title: 'FAKE TITLE', deadline: '2099-01-01' } });
    const answerSys = state.answerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const plannerSys = state.plannerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    for (const s of [answerSys, plannerSys]) {
      expect(s).toContain('W912PL26Q0042');
      expect(s).toContain('Response deadline: 2026-12-04');
      expect(s).not.toContain('FAKE TITLE');
      expect(s).not.toContain('2099-01-01');
    }
  });
  it('card chat uses the narrowed tool list; ordinary Pro chat does not', async () => {
    await post(card);
    expect(state.allowedToolNames).toBeInstanceOf(Set);
    state.pro = true;
    await post({});
    expect(state.allowedToolNames).toBeNull();
  });
  it('sources the answer to the SAM.gov notice', async () => {
    const { events } = await post(card);
    const cit = events.find((e) => e.type === 'citations') as { sources: Array<{ title: string; url: string }> };
    expect(cit.sources[0]).toMatchObject({ title: 'SAM.gov notice W912PL26Q0042', url: 'https://sam.gov/opp/x/view' });
  });
});

describe('credits: exactly once for a successful free card turn, never for failures or Pro', () => {
  it('successful free card turn → one debit of 10, credits event before done', async () => {
    const { events } = await post(card);
    expect(debitCredits).toHaveBeenCalledTimes(1);
    expect(debitCredits).toHaveBeenCalledWith(ME, 10, { reason: 'card_chat_turn', toolName: 'ask_mindy_card' });
    const types = events.map((e) => e.type);
    expect(types.indexOf('credits')).toBeGreaterThan(-1);
    expect(types.indexOf('credits')).toBeLessThan(types.indexOf('done'));
    expect(events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10, balance: 90 });
  });
  it('the model fails to answer → no debit', async () => {
    state.answerFails = true;
    await post(card);
    expect(debitCredits).not.toHaveBeenCalled();
  });
  it('an empty answer → no debit', async () => {
    state.answer = '';
    await post(card);
    expect(debitCredits).not.toHaveBeenCalled();
  });
  it('Pro on a card → answered, never debited', async () => {
    state.pro = true;
    const { events } = await post(card);
    expect(events.some((e) => e.type === 'token')).toBe(true);
    expect(debitCredits).not.toHaveBeenCalled();
  });
  it('a debit refused by the ledger (race to zero) reports 0 charged and never goes negative', async () => {
    debitCredits.mockImplementationOnce(async () => ({ ok: false, newBalance: 3 }));
    const { events } = await post(card);
    expect(events.find((e) => e.type === 'credits')).toMatchObject({ charged: 0, balance: 3 });
  });
});

describe('conversation continuity and ownership', () => {
  it('a session id owned by this user is kept', async () => {
    const sid = '11111111-2222-4333-8444-555555555555';
    state.sessions[sid] = ME;
    const { events } = await post({ ...card, sessionId: sid });
    expect(events.find((e) => e.type === 'session')).toMatchObject({ sessionId: sid });
  });
  it('another user\'s session id is NOT reused (a new one is issued)', async () => {
    const sid = '11111111-2222-4333-8444-666666666666';
    state.sessions[sid] = 'someone-else@example.com';
    const { events } = await post({ ...card, sessionId: sid });
    expect((events.find((e) => e.type === 'session') as { sessionId: string }).sessionId).not.toBe(sid);
  });
  it('the persisted assistant message records which opportunity it was about', async () => {
    await post(card);
    await new Promise((r) => setTimeout(r, 10));
    const msg = state.inserts.find((i) => i.table === 'mindy_chat_messages' && (i.row as { role?: string }).role === 'assistant')
      ?? state.inserts.find((i) => i.table === 'mindy_chat_messages');
    expect(JSON.stringify(msg?.row ?? state.inserts)).toContain(NID);
  });
});
