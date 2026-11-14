/**
 * NEW-USER JOURNEY, both release PRs together (#2042 registration grant + #2044 card chat).
 *
 * register → the registration seam grants the existing 100 credits (real grantSignupCreditsIfFirst →
 * real mcp_grant_signup_credits) → open an opportunity → Ask Mindy (real /api/app/chat route) →
 * successful answer → exactly one 10-credit debit (real debitCredits → real mcp_debit_credits) → 90 left.
 *
 * Real: both database functions (PGlite running the production migrations), credits.ts,
 * registration-grant.ts, card-chat.ts, the chat route. Mocked: auth, the model (fetch), the tool executor.
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

function fakeClient() {
  return {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === 'mcp_grant_signup_credits') {
        const r = await pg.query('SELECT * FROM mcp_grant_signup_credits($1, $2)', [a.p_user, a.p_amount]);
        return { data: r.rows, error: null };
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
  for (const f of ['20260712_mcp_credit_ledger.sql', '20260819_mcp_signup_grant_idempotent.sql']) {
    await pg.exec(readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8'));
  }
}, 60_000);

beforeEach(() => {
  answerFails = false;
  vi.stubEnv('MAP_CARD_CHAT_ENABLED', 'true');
  vi.stubEnv('SIGNUP_GRANT_AT_REGISTRATION_SINCE', new Date(Date.now() - 86_400_000).toISOString());
  vi.stubEnv('GROQ_API_KEY', 'gk'); vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    if (!b.stream) return new Response(JSON.stringify({ choices: [{ message: { content: 'no tools' } }] }), { status: 200 });
    if (answerFails) return new Response('boom', { status: 500 });
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Responses are due 2026-12-04 (SAM.gov notice W912PL26Q0042).' } }] })}\n\n`));
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

async function ask(sessionId?: string) {
  vi.resetModules();
  const { POST } = await import('./route');
  const req = new Request('https://getmindy.ai/api/app/chat', {
    method: 'POST', body: JSON.stringify({ email: ME, message: 'When is it due?', context: { kind: 'opportunity', notice_id: NID }, ...(sessionId ? { sessionId } : {}) }),
  });
  const res = await POST(req as never);
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 20));
  return { status: res.status, events: text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l!.slice(5))) };
}

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
