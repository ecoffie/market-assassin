/**
 * Ask Mindy on opportunity cards — the real /api/app/chat handler with services mocked.
 *
 * Pins, end to end through the route: the flag gate, free-vs-Pro access, the record loaded server-side
 * (never from the client), exactly one charge per question for a successful free card turn (through the
 * turn store: src/lib/chat/card-chat-turns.ts, whose SQL is proven in card-chat-turns.sql.unit.test.ts), no
 * charge for failures or Pro, free replay of a saved answer, and session ownership.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { customerErrorMessage } from '@/lib/chat/customer-errors';

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
  incumbent: unknown;
  /** sam_opportunities lookups by solicitation number / notice id (mentioned-notice.ts). */
  mentionLookups: unknown[];
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
const charges = () => completeCardTurn.mock.calls.filter(([p]) => p.credits > 0).length;

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => state.pro }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '' }));
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
// The selected-notice incumbent lookup (src/lib/chat/selected-notice.ts) — never the network in tests.
vi.mock('@/lib/usaspending/solicitation-incumbent', async (orig) => ({
  ...(await orig<object>()),
  resolveSolicitationIncumbent: async () => state.incumbent,
}));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));

function builder(table: string) {
  const q: Record<string, unknown> = {};
  let eqVal: unknown = null;
  let ilikeVal: unknown = null;
  let eqCol = '';
  q.select = () => q;
  q.eq = (k: string, v: unknown) => { eqVal = v; eqCol = k; return q; };
  q.ilike = (_k: string, v: unknown) => { ilikeVal = v; return q; };
  q.order = () => q;
  // The plain-chat mentioned-notice lookup (an exact solicitation number or notice id → rows).
  q.limit = async () => {
    if (table !== 'sam_opportunities') return { data: [], error: null };
    state.mentionLookups.push(ilikeVal != null ? `ilike:${ilikeVal}` : `${eqCol}:${eqVal}`);
    if (state.recordError) return { data: null, error: { message: 'down' } };
    const r = state.record;
    const hit = !!r && (ilikeVal != null
      ? String(r.solicitation_number).toUpperCase() === String(ilikeVal).toUpperCase()
      : eqCol === 'solicitation_number' ? r.solicitation_number === eqVal : r.notice_id === eqVal);
    return { data: hit ? [r] : [], error: null };
  };
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
      agency_hierarchy: 'DEPT OF DEFENSE.DEPT OF THE ARMY.W071 ENDIST LOS ANGELES', office_address: { city: 'LOS ANGELES', state: 'CA' },
      points_of_contact: [{ type: 'primary', fullName: 'Jane Buyer', email: 'jane.buyer@usace.army.mil', phone: '213-555-0100' }],
    },
    incumbent: {
      queried: NID, notice: null, incumbent: null, summary: null,
      prior_awards: [{ recipientName: 'ACME CLEANING LLC', awardId: 'W912PL21C0001', naicsCode: '561720', pscCode: 'S201', popPotentialEnd: '2026-12-31' }],
      _meta: { grounded_notice: true, grounded_incumbent: false, degraded: false, notice_source: 'cache', incumbent_finding: 'candidate_not_confirmed' },
    },
    recordError: false, sessions: {}, answer: 'The response deadline is 2026-12-04 (SAM.gov notice W912PL26Q0042).', answerFails: false, finishReason: 'stop',
    plannerMessages: [], answerMessages: [], inserts: [], allowedToolNames: null, mentionLookups: [],
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

describe('access', () => {
  it('flag off: a free account with context is refused exactly as before (403 pro_required)', async () => {
    vi.stubEnv('MAP_CARD_CHAT_ENABLED', '');
    const { res } = await post(card);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'pro_required' });
    expect(completeCardTurn).not.toHaveBeenCalled();
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
    await post({ ...card, context: { kind: 'opportunity', notice_id: NID, title: 'FAKE TITLE', deadline: '2099-01-01' } });
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
  it('successful free card turn → saved and charged 10 in one completion, credits event before done', async () => {
    const { events } = await post(card);
    expect(completeCardTurn).toHaveBeenCalledTimes(1);
    expect(completeCardTurn.mock.calls[0][0]).toMatchObject({ turnId: TURN, credits: 10, answer: expect.stringContaining('2026-12-04') });
    expect((completeCardTurn.mock.calls[0][0] as { citedSources: Array<{ title: string }> }).citedSources[0].title).toBe('SAM.gov notice W912PL26Q0042');
    const types = events.map((e) => e.type);
    expect(types.indexOf('credits')).toBeGreaterThan(-1);
    expect(types.indexOf('credits')).toBeLessThan(types.indexOf('done'));
    expect(events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10, balance: 90 });
  });
  it('a billable card question without a turn id is refused before any model call (400)', async () => {
    const { res } = await post({ context: card.context });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'turn_id_required' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['the model fails to answer', () => { state.answerFails = true; }],
    ['an empty answer', () => { state.answer = ''; }],
  ])('%s → no charge; the turn is marked failed (free, re-askable)', async (_n, arrange) => {
    arrange();
    await post(card);
    expect(completeCardTurn).not.toHaveBeenCalled();
    expect(turns.get(TURN)?.status).toBe('failed');
  });
  it('an incomplete (length-cut) answer → no charge', async () => {
    state.finishReason = 'length';
    await post(card);
    expect(completeCardTurn).not.toHaveBeenCalled();
    expect(failCardTurn.mock.calls[0][0]).toMatchObject({ reason: 'incomplete:length' });
  });
  it('Pro on a card → answered and saved for replay, never charged', async () => {
    state.pro = true;
    const { events } = await post(card);
    expect(events.some((e) => e.type === 'token')).toBe(true);
    expect(completeCardTurn.mock.calls[0][0]).toMatchObject({ credits: 0 });
    expect(charges()).toBe(0);
    expect(events.some((e) => e.type === 'credits')).toBe(false);
  });
  it('a debit refused by the ledger (race to zero) reports 0 charged', async () => {
    completeCardTurn.mockImplementationOnce(async () => ({ outcome: 'insufficient_balance', creditsCharged: 0, newBalance: 3 }));
    const { events } = await post(card);
    expect(events.find((e) => e.type === 'credits')).toMatchObject({ charged: 0, balance: 3 });
  });
  it('the turn store is down → 503 before any model call, nothing charged', async () => {
    claimCardTurn.mockImplementationOnce(async () => { throw new Error('db down'); });
    const { res } = await post(card);
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('completion fails (unknown outcome) → reported as nothing charged; the turn is released', async () => {
    completeCardTurn.mockImplementationOnce(async () => { throw new Error('timeout'); });
    const { events } = await post(card);
    expect(events.some((e) => e.type === 'credits')).toBe(false);
    expect(failCardTurn).toHaveBeenCalledTimes(1);
  });
});

describe('charge once per question: retry, refresh, reopen, duplicates, follow-ups', () => {
  it('retrying a completed question replays the saved answer: no model call, no charge, no balance check', async () => {
    const first = await post(card);
    const firstText = first.events.filter((e) => e.type === 'token').map((e) => e.content).join('');
    (fetch as unknown as { mockClear: () => void }).mockClear();
    state.balance = 0; // even with nothing left, the paid answer comes back
    const again = await post(card);
    expect(again.res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(again.events.filter((e) => e.type === 'token').map((e) => e.content).join('')).toBe(firstText);
    expect(again.events.find((e) => e.type === 'citations')).toMatchObject({ sources: [{ title: 'SAM.gov notice W912PL26Q0042' }] });
    expect(again.events.some((e) => e.type === 'replayed')).toBe(true);
    expect(again.events.find((e) => e.type === 'session')).toMatchObject({ sessionId: first.events.find((e) => e.type === 'session')!.sessionId });
    expect(charges()).toBe(1);
  });
  it('reopen/refresh probe (replay_only): saved answer if complete, 404 if not, never runs the model', async () => {
    const none = await post({ ...card, replay_only: true });
    expect(none.res.status).toBe(404);
    expect(await none.res.json()).toMatchObject({ error: 'turn_not_completed' });
    expect(fetch).not.toHaveBeenCalled();
    await post(card);
    (fetch as unknown as { mockClear: () => void }).mockClear();
    const replay = await post({ ...card, replay_only: true });
    expect(replay.events.some((e) => e.type === 'replayed')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(charges()).toBe(1);
  });
  it('a duplicate while the first is still answering → 409 turn_in_progress, no model call', async () => {
    turns.set(TURN, { user: ME, notice: NID, q: 'When is it due?', status: 'in_progress', token: 'other', session: null, charged: 0 });
    const { res } = await post(card);
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBe('3');
    expect(await res.json()).toMatchObject({ error: 'turn_in_progress' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('the same turn id with a different question is refused (409), never answered with the other answer', async () => {
    await post(card);
    const { res } = await post({ ...card, message: 'Who is the contracting officer?' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'turn_mismatch' });
  });
  it('a genuine follow-up (new turn id) is a new billable turn', async () => {
    await post(card);
    await post({ ...card, turn_id: '0b0b0b0b-1111-4222-8333-444444444444', message: 'Is it set aside?' });
    expect(charges()).toBe(2);
    expect(state.balance).toBe(80);
  });
  it('a failed turn retried with the same id runs again and is charged once', async () => {
    state.answerFails = true;
    await post(card);
    state.answerFails = false;
    const { events } = await post(card);
    expect(events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10 });
    expect(charges()).toBe(1);
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

describe('no duplicate charge on a dropped connection', () => {
  async function open(signal?: AbortSignal) {
    vi.resetModules();
    const { POST } = await import('./route');
    const req = new Request('https://getmindy.ai/api/app/chat', { method: 'POST', ...(signal ? { signal } : {}), body: JSON.stringify({ email: ME, message: 'When is it due?', ...card }) });
    return POST(req as never);
  }
  it('the browser disconnects before the answer completes → not charged, turn released (a retry costs once)', async () => {
    const res = await open();
    const reader = res.body!.getReader();
    await reader.read();            // the session event arrives
    await reader.cancel();          // the visitor's connection drops
    await new Promise((r) => setTimeout(r, 30));
    expect(charges()).toBe(0);
    expect(turns.get(TURN)?.status).toBe('failed');
  });
  it('production case: the request is aborted while the stream keeps being read → not charged', async () => {
    // On Vercel (2026-11-14) a closed browser did not make enqueue throw; the response stream kept
    // being drained and only the request signal reported the disconnect.
    const ac = new AbortController();
    const res = await open(ac.signal);
    const reader = res.body!.getReader();
    await reader.read();            // the session event arrives
    ac.abort();                     // the visitor's connection drops; the platform keeps reading
    for (;;) { const { done } = await reader.read(); if (done) break; }
    await new Promise((r) => setTimeout(r, 30));
    expect(charges()).toBe(0);
  });
  it('the disconnect is not detected and the answer completes → charged once, saved; the reopen replays it free', async () => {
    await post(card);                                 // completed server-side; assume the browser never saw it
    expect(charges()).toBe(1);
    const reopen = await post({ ...card, replay_only: true });
    expect(reopen.events.some((e) => e.type === 'replayed')).toBe(true);
    expect(charges()).toBe(1);
  });
  it('a retry after a dropped connection is charged exactly once', async () => {
    const res = await open();
    const reader = res.body!.getReader();
    await reader.read(); await reader.cancel();
    await new Promise((r) => setTimeout(r, 30));
    await post(card);
    await post(card);                                 // and again: a replay
    expect(charges()).toBe(1);
  });
});

describe('B2 × charge-once (integration with #2049)', () => {
  const ANSWER = 'The response deadline is 2026-12-04 (SAM.gov notice W912PL26Q0042).';
  function stubAnswer(failModels: Set<string>, opts: { throwMidStream?: boolean } = {}) {
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      if (!b.stream) return new Response(JSON.stringify({ choices: [{ message: { content: 'no tools needed' } }] }), { status: 200 });
      models.push(b.model);
      if (failModels.has(b.model)) return new Response('{"error":{"message":"model_decommissioned req_LEAK"}}', { status: 404 });
      if (opts.throwMidStream) return new Response(new ReadableStream({ start(c) { c.error(new Error('socket hang up req_LEAK')); } }), { status: 200 });
      return new Response(sseBody(ANSWER), { status: 200 });
    }));
    return models;
  }

  it('primary fails, supported fallback answers → charged exactly once, no error shown', async () => {
    const models = stubAnswer(new Set(['gpt-4o']));
    const { events } = await post(card);
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(charges()).toBe(1);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('every answer model fails → fixed customer message, no charge, turn free and re-askable', async () => {
    stubAnswer(new Set(['gpt-4o', 'gpt-4o-mini']));
    const { events } = await post(card);
    const err = events.find((e) => e.type === 'error');
    expect(err?.code).toBe('answer_unavailable');
    // The customer sees the fixed message, exactly. (A bare /404/ over the whole event stream
    // also matched random turn UUIDs, ~0.7% of runs.)
    expect(err?.message).toBe(customerErrorMessage('answer_unavailable'));
    expect(JSON.stringify(events)).not.toMatch(/model_decommissioned|req_LEAK|AI 404|"status":404/);
    expect(completeCardTurn).not.toHaveBeenCalled();
    expect(turns.get(TURN)?.status).toBe('failed');
  });

  it('a thrown stream error → fixed message, no charge, turn failed; a retry then answers and charges once', async () => {
    stubAnswer(new Set(), { throwMidStream: true });
    const first = await post(card);
    expect(first.events.find((e) => e.type === 'error')?.code).toBe('stream_failed');
    expect(JSON.stringify(first.events)).not.toMatch(/req_LEAK|socket hang up/);
    expect(turns.get(TURN)?.status).toBe('failed');
    stubAnswer(new Set());
    await post(card);
    expect(charges()).toBe(1);
    // A third request for the same question replays the saved copy for free.
    const replay = await post(card);
    expect(replay.events.some((e) => e.type === 'replayed')).toBe(true);
    expect(charges()).toBe(1);
  });
});

describe('main chat with a selected notice (Eric 2026-11-16: no card-chat flag)', () => {
  const selected = { context: { kind: 'opportunity', notice_id: NID } };
  beforeEach(() => { vi.stubEnv('MAP_CARD_CHAT_ENABLED', ''); state.pro = true; });

  it('Pro, flag off: planner and answer get the record block with buyer, DoDAAC, contact and the incumbent as stated', async () => {
    const { res } = await post({ ...selected, message: '[Current map view: VA, MD, DC]\n\nWho is the buyer?' });
    expect(res.status).toBe(200);
    const answerSys = state.answerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const plannerSys = state.plannerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    for (const s of [answerSys, plannerSys]) {
      expect(s).toContain('SELECTED OPPORTUNITY');
      expect(s).toContain('W912PL26Q0042');
      expect(s).toContain('Buying office: LA District (LOS ANGELES, CA)');
      expect(s).toContain('Office DoDAAC: W912PL');
      expect(s).toContain('jane.buyer@usace.army.mil');
      expect(s).toContain('Finding: candidate_not_confirmed');
      expect(s).toContain('NOT identified as the incumbent');
    }
  });

  it('D1: add/save/track requests are pointed at Save or "Generate proposal", never a bare "I can\'t"', async () => {
    await post({ ...selected, message: 'Add this to my pipeline' });
    for (const msgs of [state.plannerMessages[0], state.answerMessages[0]]) {
      const sys = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      expect(sys).toContain('ADD / SAVE / TRACK requests');
      expect(sys).toContain('the "Start pursuit" button on the opportunity\'s map card');
      expect(sys).toContain('"Generate proposal"');
      expect(sys).toContain('do NOT stop at "I can\'t"');
    }
  });

  it('flag off: the full tool set, no card turn claimed, nothing charged', async () => {
    await post(selected);
    expect(state.allowedToolNames).toBeNull();
    expect(claimCardTurn).not.toHaveBeenCalled();
    expect(completeCardTurn).not.toHaveBeenCalled();
  });

  it('flag off: a free account with a selected notice is still refused (main chat stays Pro)', async () => {
    state.pro = false;
    const { res } = await post(selected);
    expect(res.status).toBe(403);
  });

  it('an identified incumbent is named; the office falls back to the hierarchy leaf when SAM left office empty', async () => {
    state.record = { ...state.record!, office: null };
    state.incumbent = {
      queried: NID, notice: null, summary: null, prior_awards: [],
      incumbent: { recipientName: 'ACME CLEANING LLC', awardId: 'W912PL21C0001', naicsCode: '561720', pscCode: 'S201', popPotentialEnd: '2026-12-31' },
      _meta: { grounded_notice: true, grounded_incumbent: true, degraded: false, notice_source: 'cache', incumbent_finding: 'identified' },
    };
    await post(selected);
    const sys = state.answerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(sys).toContain('Buying office: W071 ENDIST LOS ANGELES');
    expect(sys).toContain('Incumbent award: ACME CLEANING LLC, award W912PL21C0001');
  });

  it('a selected notice Mindy does not have: the question is still answered, without a guessed record', async () => {
    state.record = null;
    const { res } = await post(selected);
    expect(res.status).toBe(200);
    const sys = state.answerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(sys).not.toContain('SELECTED OPPORTUNITY');
  });

  it('a malformed notice id is ignored (no record read, ordinary chat)', async () => {
    await post({ context: { kind: 'opportunity', notice_id: 'not-a-notice' } });
    const sys = state.answerMessages[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(sys).not.toContain('SELECTED OPPORTUNITY');
  });
});

describe('plain /app chat: the notice the user named (scorecard 2026-11-16, C1/C1b/C3)', () => {
  beforeEach(() => { state.pro = true; vi.stubEnv('MAP_CARD_CHAT_ENABLED', ''); });
  const system = (msgs: Array<{ role: string; content: string }>) => msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

  it('a solicitation number in the message grounds the answer in that notice: body, set-aside and contact', async () => {
    const { res } = await post({ message: 'Tell me about solicitation W912PL26Q0042.' });
    expect(res.status).toBe(200);
    for (const msgs of [state.plannerMessages[0], state.answerMessages[0]]) {
      const sys = system(msgs);
      expect(sys).toContain('MENTIONED OPPORTUNITY');
      expect(sys).not.toContain('SELECTED OPPORTUNITY');
      expect(sys).toContain('Provide janitorial services.');
      expect(sys).toContain('Set-aside: Total Small Business');
      expect(sys).toContain('Notice point of contact: Jane Buyer, jane.buyer@usace.army.mil');
    }
    // One indexed equality on the stored uppercase form; the ILIKE never runs on a hit.
    expect(state.mentionLookups).toEqual(['solicitation_number:W912PL26Q0042']);
  });

  it('a lowercase number misses the exact match once, then the case-insensitive lookup finds it', async () => {
    state.record = { ...state.record!, solicitation_number: 'w912pl26q0042' };
    await post({ message: 'Tell me about solicitation w912pl26q0042' });
    expect(state.mentionLookups).toEqual(['solicitation_number:W912PL26Q0042', 'ilike:w912pl26q0042']);
    expect(system(state.answerMessages[0])).toContain('MENTIONED OPPORTUNITY');
  });

  it('C1b T6: "email the contracting officer" two turns later keeps the contact from the earlier turn', async () => {
    await post({
      message: 'Email the contracting officer for me and ask for the drawings and the delivery schedule',
      history: [
        { role: 'user', content: 'Tell me about solicitation W912PL26Q0042' },
        { role: 'assistant', content: 'W912PL26Q0042 is open.' },
        { role: 'user', content: 'Add it to my pipeline' },
        { role: 'assistant', content: 'Select Start pursuit on its map card.' },
      ],
    });
    const sys = system(state.answerMessages[0]);
    expect(sys).toContain('MENTIONED OPPORTUNITY');
    expect(sys).toContain('jane.buyer@usace.army.mil');
    expect(sys).toMatch(/address a draft to that contact and cite the solicitation number/);
  });

  it('context only: no card turn, no charge, the full tool set; the source is the SAM.gov notice, not a KB doc', async () => {
    const { events } = await post({ message: 'What does W912PL26Q0042 require?' });
    expect(claimCardTurn).not.toHaveBeenCalled();
    expect(charges()).toBe(0);
    expect(state.allowedToolNames).toBeNull();
    const cites = events.find((e) => e.type === 'citations') as { sources?: Array<Record<string, unknown>> } | undefined;
    expect(cites?.sources?.[0]).toMatchObject({ doc_type: 'sam_notice', url: 'https://sam.gov/opp/x/view', document_id: null, source_path: `sam_notice:${NID}` });
  });

  it('an id that appears only in an assistant answer never attaches a notice', async () => {
    await post({ message: 'Which one should I start with?', history: [{ role: 'user', content: 'Find janitorial work' }, { role: 'assistant', content: 'Open now: W912PL26Q0042 …' }] });
    expect(system(state.answerMessages[0])).not.toContain('MENTIONED OPPORTUNITY');
    expect(state.mentionLookups).toEqual([]);
  });

  it('a number Mindy does not have: answered without a guessed record', async () => {
    const { res } = await post({ message: 'Tell me about solicitation N0017426R9999' });
    expect(res.status).toBe(200);
    expect(system(state.answerMessages[0])).not.toContain('MENTIONED OPPORTUNITY');
  });

  it('a record read failure: answered without a block', async () => {
    state.recordError = true;
    await post({ message: 'Tell me about solicitation W912PL26Q0042' });
    expect(system(state.answerMessages[0])).not.toContain('MENTIONED OPPORTUNITY');
  });

  it('an attached notice wins: the named-notice lookup does not run', async () => {
    await post({ message: 'Compare it with W912PL26Q0042', context: { kind: 'opportunity', notice_id: NID } });
    expect(system(state.answerMessages[0])).toContain('SELECTED OPPORTUNITY');
    expect(state.mentionLookups).toEqual([]);
  });

  it('a free account naming a notice in plain chat is still refused (main chat stays Pro)', async () => {
    state.pro = false;
    const { res } = await post({ message: 'Tell me about solicitation W912PL26Q0042' });
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('C2: answer first, AbilityOne by category, OSBP/OSDBU fallback', () => {
  beforeEach(() => { state.pro = true; vi.stubEnv('MAP_CARD_CHAT_ENABLED', ''); });
  const system = (msgs: Array<{ role: string; content: string }>) => msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

  it('the system prompt tells the model to answer first and to fall back to the agency small business office', async () => {
    await post({ message: 'Who is the small business contact at the top one?' });
    const sys = system(state.answerMessages[0]);
    expect(sys).toContain('ANSWER FIRST.');
    expect(sys).toMatch(/Never open with methodology/);
    expect(sys).toMatch(/call search_federal_contacts for the office AND lookup_federal_osbp for its department in the same step/);
    // Planner gets the same rule (it decides which tools run).
    expect(system(state.plannerMessages[0])).toMatch(/lookup_federal_osbp for its department/);
  });

  it('a janitorial question carries the AbilityOne caveat to the answer model', async () => {
    await post({ message: 'I run a small janitorial company in Florida. Which federal agencies should I target first, and why?' });
    expect(system(state.answerMessages[0])).toContain('core AbilityOne Program category');
  });

  it('the follow-up that does not name the work does not repeat it', async () => {
    await post({
      message: 'Who is the small business contact at the top one?',
      history: [{ role: 'user', content: 'I run a small janitorial company in Florida. Which agencies should I target?' }, { role: 'assistant', content: 'Start with VA NCO 8.' }],
    });
    expect(system(state.answerMessages[0])).not.toContain('AbilityOne Program category');
  });

  it('other work gets no AbilityOne caveat', async () => {
    await post({ message: 'Which agencies buy HVAC services in Texas?' });
    expect(system(state.answerMessages[0])).not.toContain('AbilityOne Program category');
  });
});
