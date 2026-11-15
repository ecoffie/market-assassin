/**
 * NEW-USER JOURNEY, both release PRs together (#2042 registration grant + #2044 card chat).
 *
 * register → the registration seam grants the existing 100 credits (real grantSignupCreditsIfFirst →
 * real mcp_grant_signup_credits) → open an opportunity → Ask Mindy (real /api/app/chat route) →
 * successful answer → exactly one 10-credit debit (real debitCredits → real mcp_debit_credits) → 90 left.
 *
 * Real: the database functions (PGlite running the production migrations, including the charge-once-per-
 * question turn functions), credits.ts, registration-grant.ts, card-chat.ts, card-chat-turns.ts, the chat
 * route. Mocked: auth, the model (fetch), the tool executor.
 *
 * The second block runs the approved critical disconnect cases end to end against the same real ledger.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const NID = '6ba812a7e0284f79bc44c4932777c340';
const ME = 'brand-new@example.com';
const pg = new PGlite();
const sessions = new Map<string, string>();
const messages: Array<Record<string, unknown>> = [];
const record = {
  notice_id: NID, title: 'Janitorial Services, Building 12', solicitation_number: 'W912PL26Q0042', department: 'DEPT OF DEFENSE',
  sub_tier: 'DEPT OF THE ARMY', office: 'LA District', notice_type: 'Solicitation', set_aside_description: 'Total Small Business',
  naics_code: '561720', psc_code: 'S201', posted_date: '2026-11-01', response_deadline: '2026-12-04', pop_city: null, pop_state: 'CA',
  description: 'Provide janitorial services.', sow_text: null, ui_link: 'https://sam.gov/opp/x/view', active: true,
};
let answerFails = false;
/** Hold the model's answer stream open until released (to put two requests in flight at once). */
let gate: Promise<void> | null = null;

function fakeClient() {
  return {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === 'mcp_grant_signup_credits') {
        const r = await pg.query('SELECT * FROM mcp_grant_signup_credits($1, $2)', [a.p_user, a.p_amount]);
        return { data: r.rows, error: null };
      }
      if (fn === 'card_chat_claim_turn') {
        const r = await pg.query('SELECT * FROM card_chat_claim_turn($1,$2,$3,$4,$5,$6,$7)', [a.p_turn, a.p_user, a.p_notice, a.p_session, a.p_question, a.p_lease_seconds, a.p_replay_only]);
        return { data: r.rows, error: null };
      }
      if (fn === 'card_chat_complete_turn') {
        try {
          const r = await pg.query('SELECT * FROM card_chat_complete_turn($1,$2,$3,$4,$5::jsonb,$6,$7)', [a.p_turn, a.p_token, a.p_user, a.p_answer, JSON.stringify(a.p_sources), a.p_session, a.p_credits]);
          return { data: r.rows, error: null };
        } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
      }
      if (fn === 'card_chat_fail_turn') {
        const r = await pg.query('SELECT card_chat_fail_turn($1,$2,$3) AS ok', [a.p_turn, a.p_token, a.p_reason]);
        return { data: r.rows[0]?.ok ?? false, error: null };
      }
      if (fn === 'mcp_debit_credits') {
        const r = await pg.query('SELECT * FROM mcp_debit_credits($1, $2, $3, $4, $5)', [a.p_user, a.p_amount, a.p_reason, a.p_tool, a.p_api_key_id]);
        return { data: r.rows, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    from: (table: string) => {
      let eqVal: unknown = null;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (_k: string, v: unknown) => { eqVal = v; return q; };
      q.update = () => ({ eq: async () => ({ error: null }) });
      q.insert = async (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(row) ? row : [row];
        if (table === 'mindy_chat_sessions') for (const r of rows) sessions.set(String(r.id), String(r.user_email));
        if (table === 'mindy_chat_messages') messages.push(...rows);
        return { error: null };
      };
      q.maybeSingle = async () => {
        if (table === 'mcp_credit_balance') {
          const r = await pg.query<{ balance: number }>('SELECT balance FROM mcp_credit_balance WHERE user_email = $1', [eqVal]);
          return { data: r.rows[0] ?? null, error: null };
        }
        if (table === 'sam_opportunities') return { data: eqVal === NID ? record : null, error: null };
        if (table === 'mindy_chat_sessions') { const o = sessions.get(String(eqVal)); return { data: o ? { id: eqVal, user_email: o, message_count: 2 } : null, error: null }; }
        return { data: null, error: null };
      };
      return q;
    },
  };
}

vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => fakeClient() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock('@/lib/mcp/credit-emails', () => ({ sendCreditWelcomeEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => false }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/chat-tool-executor', () => ({
  createChatToolExecutor: () => ({ offeredToolDefs: () => [], executeRound: async () => [], policyFor: () => ({ decision: 'allowed_read' }) }),
}));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));

beforeAll(async () => {
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
  for (const f of ['20260712_mcp_credit_ledger.sql', '20260819_mcp_signup_grant_idempotent.sql', '20261114_card_chat_turns.sql']) {
    await pg.exec(readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8'));
  }
}, 60_000);

beforeEach(() => {
  answerFails = false;
  gate = null;
  vi.stubEnv('MAP_CARD_CHAT_ENABLED', 'true');
  vi.stubEnv('SIGNUP_GRANT_AT_REGISTRATION_SINCE', new Date(Date.now() - 86_400_000).toISOString());
  vi.stubEnv('GROQ_API_KEY', 'gk'); vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (!b.stream) return new Response(JSON.stringify({ choices: [{ message: { content: 'no tools' } }] }), { status: 200 });
    if (answerFails) return new Response('boom', { status: 500 });
    const enc = new TextEncoder();
    const held = gate;
    const body = new ReadableStream({ async start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Responses are due 2026-12-04 (SAM.gov notice W912PL26Q0042).' } }] })}\n\n`));
      if (held) await held;
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
      c.close();
    } });
    return new Response(body, { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const balance = async () => (await pg.query<{ balance: number }>('SELECT balance FROM mcp_credit_balance WHERE user_email = $1', [ME])).rows[0]?.balance ?? null;
const ledger = async () => (await pg.query<{ delta: number; reason: string }>('SELECT delta, reason FROM mcp_credit_ledger WHERE user_email = $1 ORDER BY created_at, delta DESC', [ME])).rows;

type Ev = Record<string, unknown> & { type: string };
const parse = (text: string): Ev[] => text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l!.slice(5)));
let turnSeq = 0;
const newTurn = () => `${String(++turnSeq).padStart(8, '0')}-1111-4222-8333-444444444444`;

async function post(body: Record<string, unknown>, signal?: AbortSignal) {
  vi.resetModules();
  const { POST } = await import('./route');
  const req = new Request('https://getmindy.ai/api/app/chat', {
    method: 'POST', ...(signal ? { signal } : {}),
    body: JSON.stringify({ email: ME, message: 'When is it due?', context: { kind: 'opportunity', notice_id: NID }, ...body }),
  });
  return POST(req as never);
}
async function ask(sessionId?: string, extra: Record<string, unknown> = {}) {
  const res = await post({ turn_id: newTurn(), ...(sessionId ? { sessionId } : {}), ...extra });
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 20));
  return { status: res.status, events: parse(text) };
}
async function send(body: Record<string, unknown>) {
  const res = await post(body);
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 20));
  return { status: res.status, events: res.headers.get('content-type')?.includes('event-stream') ? parse(text) : [], json: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}
const answerOf = (events: Ev[]) => events.filter((e) => e.type === 'token').map((e) => e.content).join('');
const modelCalls = () => (fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls.filter(([, i]) => JSON.parse(i.body).stream).length;

describe('register → 100 credits → Ask Mindy on a card → 90 credits', () => {
  it('runs the whole path once, with one grant and one debit', async () => {
    // 1. Registration: the exact call the sign-in seams make, for an account created just now.
    const { scheduleRegistrationGrant } = await import('@/lib/mcp/registration-grant');
    scheduleRegistrationGrant(ME, new Date().toISOString());
    await new Promise((r) => setTimeout(r, 20));
    expect(await balance()).toBe(100);

    // A second sign-in (or a later MCP connect) does not grant again.
    const { grantSignupCreditsIfFirst } = await import('@/lib/mcp/credits');
    expect(await grantSignupCreditsIfFirst(ME)).toBe(0);
    expect(await balance()).toBe(100);

    // 2. Ask Mindy about the opportunity: a sourced answer, 10 credits charged, 90 left.
    const first = await ask();
    expect(first.status).toBe(200);
    expect(first.events.find((e) => e.type === 'token')?.content).toContain('2026-12-04');
    expect(first.events.find((e) => e.type === 'citations')?.sources?.[0]?.title).toBe('SAM.gov notice W912PL26Q0042');
    expect(first.events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10, balance: 90 });
    expect(await balance()).toBe(90);

    // 3. A failed answer costs nothing.
    answerFails = true;
    await ask();
    expect(await balance()).toBe(90);

    // 4. The follow-up question continues the same conversation and costs 10 more.
    answerFails = false;
    const sid = first.events.find((e) => e.type === 'session')?.sessionId as string;
    const second = await ask(sid);
    expect(second.events.find((e) => e.type === 'session')?.sessionId).toBe(sid);
    expect(await balance()).toBe(80);

    // The ledger tells the whole story: one grant, two charges, nothing else.
    expect(await ledger()).toEqual([
      { delta: 100, reason: 'signup_grant' },
      { delta: -10, reason: 'card_chat_turn' },
      { delta: -10, reason: 'card_chat_turn' },
    ]);
  });
});

describe('charge once per question: the approved critical cases, real route + real ledger', () => {
  // Continues from the journey above: the account holds 80 credits.
  const turnRow = async (t: string) => (await pg.query<{ status: string; credits_charged: number; answer: string | null; failure_reason: string | null }>(
    'SELECT status, credits_charged, answer, failure_reason FROM card_chat_turns WHERE turn_id = $1', [t])).rows[0];
  const charges = async () => (await ledger()).filter((r) => r.reason === 'card_chat_turn').length;

  it('1. disconnect BEFORE the answer completes → no charge; retrying the same question is charged once', async () => {
    const T = newTurn();
    gate = new Promise<void>(() => {}); // the model never finishes while the browser is connected
    const ac = new AbortController();
    const res = await post({ turn_id: T }, ac.signal);
    const reader = res.body!.getReader();
    await reader.read();               // session event
    ac.abort(); await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(await turnRow(T)).toMatchObject({ status: 'failed', credits_charged: 0, failure_reason: 'client_disconnected' });
    expect(await balance()).toBe(80);
    gate = null;
    const retry = await send({ turn_id: T });
    expect(retry.events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10, balance: 70 });
    expect(await balance()).toBe(70);
  });

  it('1b. disconnect MID-answer (part of the text already shown) → incomplete, free; nothing saved to replay', async () => {
    const T = newTurn();
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const ac = new AbortController();
    const res = await post({ turn_id: T }, ac.signal);
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let seen = '';
    while (!seen.includes('"type":"token"')) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); }
    expect(seen).toContain('2026-12-04');  // the customer saw the start of the answer
    ac.abort();                            // ...then left before it finished
    release();                             // the model keeps going
    for (;;) { const { done } = await reader.read().catch(() => ({ done: true })); if (done) break; }
    await new Promise((r) => setTimeout(r, 50));
    gate = null;
    expect(await turnRow(T)).toMatchObject({ status: 'failed', credits_charged: 0, failure_reason: 'client_disconnected' });
    expect(await balance()).toBe(70);
    const reopen = await send({ turn_id: T, replay_only: true });
    expect(reopen.status).toBe(404);
  });

  it('2. disconnect AFTER completion, before the browser receives it → charged once; the reopen gets it free', async () => {
    const T = newTurn();
    const res = await post({ turn_id: T });
    await res.body!.cancel().catch(() => {}); // the browser is gone; the server is not told (the Vercel case)
    await new Promise((r) => setTimeout(r, 50));
    const row = await turnRow(T);
    // If the server saw the cancel in time it stops and charges nothing; if not, it completes and charges once.
    // Either way the customer is never charged twice and never charged for an answer they cannot get back.
    if (row.status === 'completed') {
      expect(row.credits_charged).toBe(10);
      expect(await balance()).toBe(60);
      const reopen = await send({ turn_id: T, replay_only: true });
      expect(answerOf(reopen.events)).toBe(row.answer);
      expect(reopen.events.some((e) => e.type === 'replayed')).toBe(true);
      expect(await balance()).toBe(60);
    } else {
      expect(row).toMatchObject({ status: 'failed', credits_charged: 0 });
      expect(await balance()).toBe(70);
      await send({ turn_id: T });
    }
    expect(await balance()).toBe(60);
  });

  it('2b. completed but never delivered (deterministic): the server saved it; reopen replays it, no model call, no charge', async () => {
    const T = newTurn();
    const first = await send({ turn_id: T });   // completes server-side
    expect(await balance()).toBe(50);
    const before = modelCalls();
    const reopen = await send({ turn_id: T, replay_only: true });
    expect(answerOf(reopen.events)).toBe(answerOf(first.events));
    expect(reopen.events.find((e) => e.type === 'citations')).toMatchObject({ sources: [{ title: 'SAM.gov notice W912PL26Q0042' }] });
    expect(modelCalls()).toBe(before);
    expect(await balance()).toBe(50);
  });

  it('3. refresh and reopen: replay_only with nothing saved runs nothing; with a saved answer, returns it free', async () => {
    const T = newTurn();
    const before = modelCalls();
    const empty = await send({ turn_id: T, replay_only: true });
    expect(empty.status).toBe(404);
    expect(empty.json).toMatchObject({ error: 'turn_not_completed' });
    expect(modelCalls()).toBe(before);
    expect(await turnRow(T)).toBeUndefined();
    expect(await balance()).toBe(50);
  });

  it('4. retry the same question after it completed → the saved answer, same session, no model call, no charge', async () => {
    const T = newTurn();
    const first = await send({ turn_id: T });
    expect(await balance()).toBe(40);
    const before = modelCalls();
    const retry = await send({ turn_id: T });
    expect(retry.status).toBe(200);
    expect(answerOf(retry.events)).toBe(answerOf(first.events));
    expect(retry.events.find((e) => e.type === 'session')?.sessionId).toBe(first.events.find((e) => e.type === 'session')?.sessionId);
    expect(modelCalls()).toBe(before);
    expect(await balance()).toBe(40);
  });

  it('5. two concurrent requests with the same turn id → one answer, one charge; the other gets 409 then the replay', async () => {
    const T = newTurn();
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const a = post({ turn_id: T });
    const b = post({ turn_id: T });
    const [ra, rb] = await Promise.all([a, b]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(await loser.json()).toMatchObject({ error: 'turn_in_progress' });
    release();
    const winner = ra.status === 200 ? ra : rb;
    await winner.text();
    await new Promise((r) => setTimeout(r, 30));
    gate = null;
    expect(await balance()).toBe(30);
    const after = await send({ turn_id: T });
    expect(after.events.some((e) => e.type === 'replayed')).toBe(true);
    expect(await balance()).toBe(30);
  });

  it('6. a genuine follow-up (new turn id) in the same conversation is a new billable turn', async () => {
    const first = await ask();
    const sid = first.events.find((e) => e.type === 'session')?.sessionId as string;
    expect(await balance()).toBe(20);
    const follow = await ask(sid, { message: 'And is it set aside for small business?' });
    expect(follow.events.find((e) => e.type === 'session')?.sessionId).toBe(sid);
    expect(follow.events.find((e) => e.type === 'credits')).toMatchObject({ charged: 10, balance: 10 });
  });

  it('the ledger matches the completed turns exactly: one card_chat_turn debit per completed, charged turn', async () => {
    const completedCharged = (await pg.query<{ n: number }>("SELECT count(*)::int n FROM card_chat_turns WHERE user_email = $1 AND status = 'completed' AND credits_charged = 10", [ME])).rows[0].n;
    // The journey's two charges predate turn ids (they used ask() which now mints turns, so they are rows too).
    expect(await charges()).toBe(completedCharged);
    expect(await balance()).toBe(100 - 10 * (await charges()));
  });
});
