/**
 * Reopened conversations get their signed source ledger back (ASK_MINDY_RECIPES, default off), only for the
 * authenticated owner's session, only on assistant messages, and never the rest of the trace. DELETE removes the
 * session for its owner only; the messages (and the ledger inside their trace) cascade with it
 * (mindy_chat_messages.session_id REFERENCES mindy_chat_sessions(id) ON DELETE CASCADE, 20260527_mindy_chat.sql).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const ME = 'pro@example.com';
const S1 = '11111111-1111-4111-8111-111111111111';
const LEDGER = { v: 1, entries: [{ id: 'src:get_expiring_contracts:call_0', kind: 'federal_record', tool: 'get_expiring_contracts', label: 'Expiring contracts', status: 'ok', retrievedAt: '2026-11-22', items: [{ n: 1, key: '36C24825C0020', label: '' }] }], sig: 'abc' };

const state: { sessions: Array<Record<string, unknown>>; messages: Array<Record<string, unknown>>; deletes: Array<Record<string, unknown>> } = { sessions: [], messages: [], deletes: [] };

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));

function builder(table: string) {
  const f: Record<string, unknown> = {};
  let deleting = false;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.delete = () => { deleting = true; return q; };
  q.eq = (k: string, v: unknown) => { f[k] = v; return q; };
  q.in = () => q; q.limit = () => q; q.order = () => q; q.range = () => q;
  q.maybeSingle = async () => ({ data: state.sessions.find((s) => s.id === f.id) ?? null, error: null });
  q.then = (res: (v: unknown) => unknown) => {
    if (deleting) { state.deletes.push({ table, ...f }); return Promise.resolve({ error: null }).then(res); }
    if (table === 'mindy_chat_sessions') return Promise.resolve({ data: state.sessions, error: null }).then(res);
    return Promise.resolve({ data: state.messages.filter((m) => m.session_id === f.session_id), error: null }).then(res);
  };
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubEnv('ASK_MINDY_RECIPES', ''); vi.stubEnv('ASK_MINDY_RECIPES_ALLOWLIST', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.deletes = [];
  state.sessions = [{ id: S1, user_email: ME, title: 'Renewals', message_count: 2, updated_at: '2026-11-22T10:00:00Z' }];
  state.messages = [
    { id: 'u1', session_id: S1, role: 'user', content: 'Which VA contracts are coming up?', created_at: '1', cited_sources: [], trace: { ledger: LEDGER } },
    { id: 'a1', session_id: S1, role: 'assistant', content: 'Here they are.', created_at: '2', cited_sources: [], trace: { ledger: LEDGER, notices: ['secret-notice'], tool_executions: [{ tool: 'x' }] } },
  ];
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function get(email: string) {
  vi.resetModules();
  const { GET } = await import('./route');
  const res = await GET({ nextUrl: new URL(`https://getmindy.ai/api/app/chat-sessions?email=${email}&sessionId=${S1}`) } as never);
  return { status: res.status, body: await res.json() };
}

describe('reopened conversation: the signed ledger comes back for the owner only', () => {
  it('flag on for the owner: assistant messages carry `sources`; user messages never; no other trace field', async () => {
    vi.stubEnv('ASK_MINDY_RECIPES', 'allowlist'); vi.stubEnv('ASK_MINDY_RECIPES_ALLOWLIST', ME);
    const { body } = await get(ME);
    const [u, a] = body.messages;
    expect(a.sources).toEqual(LEDGER);
    expect(u.sources).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/secret-notice|tool_executions|"trace"/);
  });
  it('flag off: no ledger is returned', async () => {
    const { body } = await get(ME);
    expect(body.messages[1].sources).toBeUndefined();
  });
  it('another account: 404 and nothing returned (the existing owner check)', async () => {
    vi.stubEnv('ASK_MINDY_RECIPES', 'true');
    const r = await get('someone-else@example.com');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('36C24825C0020');
  });
});

describe('DELETE removes the conversation, ledger included', () => {
  it('deletes only the owner\'s session row; messages cascade in the schema', async () => {
    vi.resetModules();
    const { DELETE } = await import('./route');
    const res = await DELETE({ json: async () => ({ email: ME, sessionId: S1 }) } as never);
    expect(res.status).toBe(200);
    expect(state.deletes).toEqual([{ table: 'mindy_chat_sessions', id: S1, user_email: ME }]);
    const schema = readFileSync(`${process.cwd()}/supabase/migrations/20260527_mindy_chat.sql`, 'utf8');
    expect(schema).toMatch(/session_id UUID NOT NULL REFERENCES mindy_chat_sessions\(id\) ON DELETE CASCADE/);
  });
});
