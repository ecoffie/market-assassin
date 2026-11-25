/**
 * Ask Mindy rules layer (src/lib/chat/ask-mindy-rules.ts) through the real /api/app/chat handler.
 * Off (the default) → the system prompt is the pre-existing one. On → the rules layer and answer format
 * reach both the planner and the answer, and the FIND contract's list lengths are replaced.
 * Harness copied from display-hint.route.unit.test.ts (services mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const NID = '6ba812a7e0284f79bc44c4932777c340';
const ME = 'free@example.com';

const state: {
  pro: boolean;
  balance: number | null; balanceError: boolean;
  record: Record<string, unknown> | null; recordError: boolean;
  sessions: Record<string, string>;
  answer: string; answerFails: boolean; finishReason: string;
  plannerMessages: Array<Array<{ role: string; content: string }>>;
  answerMessages: Array<Array<{ role: string; content: string }>>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  allowedToolNames: unknown;
} = {} as never;

// In-memory turn store with the SQL functions' semantics (claim / complete = save + debit once / fail).
type Turn = { user: string; notice: string; q: string; status: 'in_progress' | 'completed' | 'failed'; token: string | null; answer?: string; sources?: unknown[]; session: string | null; charged: number };
const turns = new Map<string, Turn>();
let tokenSeq = 0;
const claimCardTurn = vi.fn(async (p: { turnId: string; email: string; noticeId: string; sessionId: string | null; question: string; replayOnly: boolean }) => {
  const t = turns.get(p.turnId);
  if (!t) {
    if (p.replayOnly) return { outcome: 'not_completed', sessionId: null };
    const token = `tok-${++tokenSeq}`;
    turns.set(p.turnId, { user: p.email, notice: p.noticeId, q: p.question, status: 'in_progress', token, session: p.sessionId, charged: 0 });
    return { outcome: 'claimed', claimToken: token, sessionId: p.sessionId };
  }
  if (t.user !== p.email || t.notice !== p.noticeId || t.q !== p.question) return { outcome: 'mismatch', sessionId: null };
  if (t.status === 'completed') return { outcome: 'completed', answer: t.answer, citedSources: t.sources, sessionId: t.session, creditsCharged: t.charged };
  if (t.status === 'in_progress') return { outcome: 'in_progress', sessionId: t.session };
  if (p.replayOnly) return { outcome: 'not_completed', sessionId: t.session };
  t.status = 'in_progress'; t.token = `tok-${++tokenSeq}`;
  return { outcome: 'claimed', claimToken: t.token, sessionId: t.session ?? p.sessionId };
});
const completeCardTurn = vi.fn(async (p: { turnId: string; claimToken: string; answer: string; citedSources: unknown[]; credits: number }) => {
  const t = turns.get(p.turnId)!;
  if (t.status === 'completed') return { outcome: 'already_completed', creditsCharged: t.charged, newBalance: null };
  if (t.token !== p.claimToken) return { outcome: 'lost_claim', creditsCharged: 0, newBalance: null };
  let outcome = 'not_billable'; let newBalance: number | null = null;
  if (p.credits > 0) {
    const ok = (state.balance ?? 0) >= p.credits;
    if (ok) state.balance = (state.balance ?? 0) - p.credits;
    outcome = ok ? 'charged' : 'insufficient_balance'; newBalance = state.balance; t.charged = ok ? p.credits : 0;
  }
  Object.assign(t, { status: 'completed', token: null, answer: p.answer, sources: p.citedSources });
  return { outcome, creditsCharged: t.charged, newBalance };
});
const failCardTurn = vi.fn(async (p: { turnId: string; claimToken: string; reason: string }) => {
  const t = turns.get(p.turnId);
  if (t && t.status === 'in_progress' && t.token === p.claimToken) { t.status = 'failed'; t.token = null; }
});

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => state.pro }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/card-chat-turns', async (orig) => ({
  ...(await orig<object>()),
  claimCardTurn: (p: never) => claimCardTurn(p), completeCardTurn: (p: never) => completeCardTurn(p), failCardTurn: (p: never) => failCardTurn(p),
}));
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
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: state.finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
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
    recordError: false, sessions: {}, answer: 'The response deadline is 2026-12-04 (SAM.gov notice W912PL26Q0042).', answerFails: false, finishReason: 'stop',
    plannerMessages: [], answerMessages: [], inserts: [], allowedToolNames: null,
  });
  turns.clear(); tokenSeq = 0;
  claimCardTurn.mockClear(); completeCardTurn.mockClear(); failCardTurn.mockClear();
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
const TURN = '0a0a0a0a-1111-4222-8333-444444444444';
const card = { context: { kind: 'opportunity', notice_id: NID }, turn_id: TURN };

const sysOf = (msgs: Array<{ role: string; content: string }>) => msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
const FIND_Q = 'What should we go after in Tennessee?';
const FMP_Q = 'Build a federal market profile for our company with pathways in priority order.';

describe('Ask Mindy rules layer flag', () => {
  beforeEach(() => { state.pro = true; });

  it('off by default: no rules layer, the shared FIND contract with its list lengths', async () => {
    await post({ message: FIND_Q });
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).not.toContain('ASK MINDY RULES');
    expect(sys).not.toContain('ANSWER FORMAT');
    expect(sys).toContain('list every open notice that is genuinely the work asked for (up to 10');
  });

  it("'true': planner and answer both get the rules layer, the answer format and the top-picks FIND contract", async () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'true');
    await post({ message: FIND_Q });
    for (const msgs of [state.plannerMessages[0], state.answerMessages[0]]) {
      const sys = sysOf(msgs);
      expect(sys).toContain('ASK MINDY RULES');
      expect(sys).toContain('TOP PICKS (ranked by fit for');
      expect(sys).toContain('Pick the 3 to 5 best fits');
      expect(sys).not.toContain('(up to 10');
      expect(sys).toContain('- Classify first.');
    }
  });

  it("'allowlist': on for a listed email only", async () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'allowlist');
    vi.stubEnv('ASK_MINDY_RULES_ALLOWLIST', 'someone-else@example.com');
    await post({ message: FIND_Q });
    expect(sysOf(state.answerMessages[0])).not.toContain('ASK MINDY RULES');
    state.answerMessages = []; state.plannerMessages = [];
    vi.stubEnv('ASK_MINDY_RULES_ALLOWLIST', ME);
    await post({ message: FIND_Q });
    expect(sysOf(state.answerMessages[0])).toContain('ASK MINDY RULES');
  });

  it('Federal Market Profile ask, flag off: the FMP contract and no rules layer (unchanged from #2204)', async () => {
    await post({ message: FMP_Q });
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).toContain('FEDERAL MARKET PROFILE (company-first pathway report');
    expect(sys).not.toContain('ASK MINDY RULES');
    expect(sys).not.toContain('FINDING OPPORTUNITIES');
  });

  it("Federal Market Profile ask, flag on: keeps its own contract, gets the rules, never the top-picks answer format", async () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'true');
    await post({ message: FMP_Q });
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).toContain('FEDERAL MARKET PROFILE (company-first pathway report');
    expect(sys).toContain('ASK MINDY RULES');
    expect(sys).not.toContain('ANSWER FORMAT');
    expect(sys).not.toContain('Pick the 3 to 5 best fits');
  });

  it('billed (non-Pro) card chat gets the rules layer but keeps the reduced pipeline: no FIND contract, card tools only', async () => {
    state.pro = false;
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'true');
    const { res } = await post(card);
    expect(res.status).toBe(200);
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).toContain('ASK MINDY RULES');
    expect(sys).not.toContain('FINDING OPPORTUNITIES');
    expect(state.allowedToolNames).not.toBeNull();
    expect(completeCardTurn).toHaveBeenCalledWith(expect.objectContaining({ credits: 10 }));
  });

  it('Pro card chat runs the full pipeline: rules layer, FIND contract, every tool, charged nothing', async () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'true');
    const { res } = await post({ ...card, message: FIND_Q });
    expect(res.status).toBe(200);
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).toContain('ASK MINDY RULES');
    expect(sys).toContain('FINDING OPPORTUNITIES');
    expect(sys).toContain('W912PL26Q0042');
    expect(state.allowedToolNames).toBeNull();
    expect(completeCardTurn).toHaveBeenCalledTimes(1);
    expect(completeCardTurn).toHaveBeenCalledWith(expect.objectContaining({ credits: 0 }));
  });
});
