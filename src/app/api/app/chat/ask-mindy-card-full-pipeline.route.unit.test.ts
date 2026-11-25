/**
 * Card chat runs the FULL Ask Mindy pipeline (Eric, 2026-11-25: "the ask mindy in the maps is supposed to be the
 * claude mcp replacement so it needs everything") — for a NON-BILLED (Pro) card turn. A billed card turn is a flat
 * per-turn charge, so it keeps the reduced pipeline until pricing is decided. Billing is unchanged either way.
 * Harness copied from ask-mindy-rules-layer.route.unit.test.ts (in-memory card turn store with the SQL semantics).
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

const gate = vi.hoisted(() => ({ run: vi.fn(), extract: vi.fn() }));
vi.mock('@/lib/ask-mindy/intelligence-gate', async (orig) => ({ ...(await orig<object>()), runIntelligenceGate: (a: never) => gate.run(a) }));
vi.mock('@/lib/ask-mindy/gate-intent', async (orig) => ({ ...(await orig<object>()), extractWorkPhrase: (a: never) => gate.extract(a) }));
vi.mock('@/lib/ask-mindy/company-profile', async (orig) => ({ ...(await orig<object>()), loadCompanyProfile: async () => ({ status: 'ok', workspace: 'own', profile: { companyName: 'Acme Clean', certifications: [], unknown: [] } }) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: async () => ({ status: 'none' }), answerUsesNotice: () => false }));

const sysOf = (msgs: Array<{ role: string; content: string }>) => msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
const MARKET_Q = 'What open opportunities are there for janitorial services in Florida?';
const FMP_Q = 'Build a federal market profile for our company with pathways in priority order.';
const GATE_ANSWER = 'Start with Building 12 (W912PL26Q0042).';
const gateOn = () => { vi.stubEnv('ASK_MINDY_INTELLIGENCE_GATE', 'true'); vi.stubEnv('ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST', ME); };
const tokens = (ev: Array<Record<string, unknown>>) => ev.filter((e) => e.type === 'token').map((e) => String(e.content)).join('');

beforeEach(() => {
  gate.run.mockReset();
  gate.run.mockImplementation(async () => ({
    status: 'complete', attempts: 1, decision: {}, evaluation: { pass: true, results: [], fix: [] }, checks: [], report: null,
    answer: GATE_ANSWER, cost: { analystIn: 1, analystOut: 1, evalIn: 1, evalOut: 1 },
  }));
  gate.extract.mockReset();
  gate.extract.mockImplementation(async () => 'janitorial services');
});

describe('card chat: intelligence gate', () => {
  it('Pro card turn, gate on: the gate runs with the selected notice as a known candidate; completed at 0 credits', async () => {
    state.pro = true; gateOn();
    const { res, events } = await post({ ...card, message: MARKET_Q });
    expect(res.status).toBe(200);
    expect(gate.run).toHaveBeenCalledTimes(1);
    const arg = gate.run.mock.calls[0][0] as { knownOpenItems?: Array<Record<string, unknown>> };
    expect(arg.knownOpenItems).toHaveLength(1);
    expect(arg.knownOpenItems![0]).toMatchObject({ notice_id: NID, solicitation_number: 'W912PL26Q0042', naics_code: '561720', response_deadline: '2026-12-04' });
    expect(tokens(events)).toBe(GATE_ANSWER);
    expect(state.answerMessages).toHaveLength(0);
    expect(completeCardTurn).toHaveBeenCalledTimes(1);
    expect(completeCardTurn).toHaveBeenCalledWith(expect.objectContaining({ answer: GATE_ANSWER, credits: 0 }));
    expect(failCardTurn).not.toHaveBeenCalled();
  });

  it('Pro card turn, gate on: a retry with the same turn_id replays the gate answer without re-running anything', async () => {
    state.pro = true; gateOn();
    await post({ ...card, message: MARKET_Q });
    const { res, events } = await post({ ...card, message: MARKET_Q });
    expect(res.status).toBe(200);
    expect(gate.run).toHaveBeenCalledTimes(1);
    expect(completeCardTurn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).toContain(GATE_ANSWER);
  });

  it('billed card turn, gate on: reduced pipeline, the gate never runs, charged the flat card price once', async () => {
    state.pro = false; gateOn();
    const before = state.balance!;
    const { res } = await post({ ...card, message: MARKET_Q });
    expect(res.status).toBe(200);
    expect(gate.run).not.toHaveBeenCalled();
    expect(state.allowedToolNames).not.toBeNull();
    expect(completeCardTurn).toHaveBeenCalledWith(expect.objectContaining({ credits: 10 }));
    expect(state.balance).toBe(before - 10);
  });

  it('Pro card turn, gate flag off: unchanged — the gate never runs; the answer path completes at 0 credits', async () => {
    state.pro = true;
    const { res } = await post({ ...card, message: MARKET_Q });
    expect(res.status).toBe(200);
    expect(gate.run).not.toHaveBeenCalled();
    expect(state.answerMessages).toHaveLength(1);
    expect(state.allowedToolNames).toBeNull();
    expect(completeCardTurn).toHaveBeenCalledWith(expect.objectContaining({ credits: 0 }));
  });
});

describe('card chat: answer contracts and tools', () => {
  it('Pro card turn: a Federal Market Profile ask gets the FMP contract, every tool, and the selected notice', async () => {
    state.pro = true;
    await post({ ...card, message: FMP_Q });
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).toContain('FEDERAL MARKET PROFILE (company-first pathway report — not a keyword market-size report):');
    expect(sys).toContain('W912PL26Q0042');
    expect(state.allowedToolNames).toBeNull();
  });

  it('billed card turn: the same ask keeps the reduced card contract (no FMP host contract, card tools only)', async () => {
    state.pro = false;
    await post({ ...card, message: FMP_Q });
    const sys = sysOf(state.answerMessages[0]);
    expect(sys).not.toContain('FEDERAL MARKET PROFILE (company-first pathway report — not a keyword market-size report):');
    expect(sys).toContain('W912PL26Q0042');
    expect(state.allowedToolNames).not.toBeNull();
  });
});
