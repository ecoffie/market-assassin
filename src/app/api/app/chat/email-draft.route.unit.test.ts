/**
 * Ask Mindy + connected apps Slice B through the real /api/app/chat handler (harness from
 * connected-files.route.unit.test.ts): create_email_draft is offered only when CONNECTED_APPS is on for the caller and
 * never in card chat; when it runs, it uses the server's acting scope (re-resolved) and the caller's own connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = 'owner@acme.com';
const SID = '0b0b0b0b-1111-4222-8333-555555555555';
const NOTICE = 'aa23533a4cef40deb6e04b005f5c60f5';
const FILE_TEXT = 'BRIGHTLINE TEST CO is a Service-Disabled Veteran-Owned Small Business with Bay Pines VA janitorial past performance.';

const state = vi.hoisted(() => ({
  plannerMessages: [] as Array<Array<{ role: string; content: string }>>,
  answerMessages: [] as Array<Array<{ role: string; content: string }>>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  providerCalls: [] as string[],
  providerStatus: 200,
  tokenCalls: [] as unknown[][],
  guardText: [] as string[],
  offered: [] as string[][],
  connRows: [] as Array<Record<string, unknown>>,
  execute: null as null | ((n: string, a: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: async () => {} }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));
vi.mock('@/lib/chat/chat-tool-executor', async (orig) => ({
  ...(await orig<object>()),
  createChatToolExecutor: (opts: { tier0: { names: ReadonlySet<string>; defs: Array<{ function: { name: string } }>; execute: (n: string, a: Record<string, unknown>) => Promise<unknown> } }) => {
    state.offered.push([...opts.tier0.names]);
    state.execute = opts.tier0.execute;
    return { offeredToolDefs: () => [], executeRound: async () => [], policyFor: () => ({ decision: 'allowed_read' }) };
  },
}));
vi.mock('@/lib/chat/tier0-tools', () => ({ makeTier0Tools: () => ({ execute: async () => ({}) }), TIER0_TOOL_DEFS: [], TIER0_TOOL_NAMES: new Set() }));
vi.mock('@/lib/chat/chat-acting-scope', async (orig) => ({ ...(await orig<object>()), resolveChatActingScope: async (email: string) => ({ kind: 'own', email }) }));
// The turn's document guard (search_web refuses queries that would leak document text) must see the file text.
vi.mock('@/lib/chat/search-web-tool', async (orig) => {
  const real = await orig<typeof import('@/lib/chat/search-web-tool')>();
  return { ...real, makeSearchWebTool: (opts: { documentText?: () => string }) => { state.guardText.push(opts?.documentText?.() ?? ''); return real.makeSearchWebTool(opts as never); } };
});
vi.mock('@/lib/connected-apps/store', async (orig) => ({
  ...(await orig<object>()),
  accessTokenFor: async (...args: unknown[]) => {
    state.tokenCalls.push(args);
    return { ok: true, token: 'at', provider: 'microsoft', connection: { id: 'conn-1', provider: 'microsoft', connected_email: ME, display_name: null, granted_scopes: [], status: 'connected', created_at: '' } };
  },
}));

function builder(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'or', 'in', 'order', 'limit', 'not', 'gte', 'lte', 'neq', 'is', 'eq']) q[m] = () => q;
  q.update = (row: Record<string, unknown>) => { state.updates.push({ table, row }); return { eq: async () => ({ error: null }) }; };
  q.insert = async (row: Record<string, unknown>) => { state.inserts.push({ table, row }); return { error: null }; };
  q.upsert = async (row: Record<string, unknown>) => { state.inserts.push({ table, row }); return { error: null }; };
  // The attached notice (card and selected-notice turns) carries a published point of contact.
  q.maybeSingle = async () => ({ data: table === 'sam_opportunities' ? { notice_id: NOTICE, title: 'Janitorial services', points_of_contact: [{ fullName: 'C. Jones', email: 'co.jones@example.gov' }] } : null, error: null });
  q.single = async () => ({ data: null, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: table === 'connected_accounts' ? state.connRows : [], error: null });
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) }) }));

function sseBody(text: string) {
  const enc = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}


beforeEach(async () => {
  state.plannerMessages = []; state.answerMessages = []; state.inserts = []; state.updates = []; state.providerCalls = []; state.providerStatus = 200; state.tokenCalls = []; state.guardText = []; state.offered = []; state.execute = null; state.connRows = [];
  vi.stubEnv('CONNECTED_APPS', 'true');
  vi.stubEnv('CONNECTED_APPS_ALLOWLIST', ME);
  vi.stubEnv('CONNECTED_APPS_STATE_SECRET', 'state-secret-test-0123456789abcdef0123');
  vi.stubEnv('CONNECTED_APPS_TOKEN_ENC_KEY', 'token-key-test-0123456789abcdef01234567');
  vi.stubEnv('OPENAI_API_KEY', 'ok'); vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { body?: string }) => {
    if (String(u).startsWith('https://graph.microsoft.com/')) {
      state.providerCalls.push(String(u));
      if (state.providerStatus !== 200) return new Response('{}', { status: state.providerStatus });
      if (String(u).endsWith('/content')) return new Response(FILE_TEXT);
      return new Response(JSON.stringify({ id: 'item-1', name: 'Brightline Cap Statement.txt', size: FILE_TEXT.length, file: { mimeType: 'text/plain' }, webUrl: 'https://onedrive.live.com/x', lastModifiedDateTime: '2026-11-20T00:00:00Z' }));
    }
    const b = JSON.parse(String(init?.body || '{}'));
    if (b.stream) { state.answerMessages.push(b.messages); return new Response(sseBody('Per the connected file, if your SDVOSB certification is current you qualify.'), { status: 200 }); }
    state.plannerMessages.push(b.messages);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'no tools needed' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ask(body: Record<string, unknown> = {}) {
  vi.resetModules();
  const { POST } = await import('./route');
  const res = await POST(new Request('https://getmindy.ai/api/app/chat', { method: 'POST', body: JSON.stringify({ email: ME, message: 'What janitorial opportunities fit us in Florida?', sessionId: SID, ...body }) }) as never);
  const text = await res.text();
  for (let i = 0; i < 50 && !state.inserts.some((x) => x.table === 'mindy_chat_messages'); i++) await new Promise((r) => setTimeout(r, 10));
  return { res, text };
}

describe('create_email_draft in the chat route', () => {
  it('flag on: offered to the planner as a private tool', async () => {
    await ask();
    expect(state.offered.flat()).toContain('create_email_draft');
  });

  it('flag off (or caller not allowlisted): never offered', async () => {
    vi.stubEnv('CONNECTED_APPS', 'false');
    await ask();
    expect(state.offered.flat()).not.toContain('create_email_draft');
    vi.stubEnv('CONNECTED_APPS', 'true');
    vi.stubEnv('CONNECTED_APPS_ALLOWLIST', 'someone-else@acme.com');
    state.offered = [];
    await ask();
    expect(state.offered.flat()).not.toContain('create_email_draft');
  });

  it('card chat: never offered', async () => {
    vi.stubEnv('MAP_CARD_CHAT_ENABLED', 'true');
    const { res } = await ask({ context: { kind: 'opportunity', notice_id: NOTICE } });
    expect(res.status).toBe(200);
    expect(state.offered.length).toBeGreaterThan(0); // the card turn reached tool setup
    expect(state.offered.flat()).not.toContain('create_email_draft');
  });

  it('when run with no connected account it says so (copy-paste fallback); nothing is sent anywhere', async () => {
    await ask();
    expect(state.execute).toBeTruthy();
    const r = await state.execute!('create_email_draft', { subject: 'Custodial services at the clinic', body: 'Your office bought custodial services last year.\n--\nPat' }) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: false, error_category: 'not_connected' });
    expect(String(r.message)).toMatch(/copy-paste text/);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => /gmail\.googleapis\.com|graph\.microsoft\.com\/v1\.0\/me\/messages/.test(u))).toBe(false);
  });

  it('a connected Outlook account with draft permission: saves the draft through Graph with the notice\'s published contact', async () => {
    state.connRows = [{ id: 'conn-1', provider: 'microsoft', connected_email: ME, display_name: null, granted_scopes: ['Mail.ReadWrite', 'Files.Read'], status: 'connected', created_at: '' }];
    await ask({ context: { kind: 'opportunity', notice_id: NOTICE } }); // main chat (card chat off): attached notice
    const r = await state.execute!('create_email_draft', { to: 'co.jones@example.gov', subject: 'Janitorial services at your clinic', body: 'Your office bought janitorial services last year.\n--\nPat' }) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, action: 'draft_saved_not_sent', provider: 'microsoft', recipient: 'co.jones@example.gov', recipient_status: 'cited' });
    expect(state.tokenCalls.at(-1)).toEqual([`own:${ME}`, ME, 'conn-1']);
    const posted = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.filter((c) => String(c[0]) === 'https://graph.microsoft.com/v1.0/me/messages');
    expect(posted).toHaveLength(1);
    expect(JSON.parse(String(posted[0][1].body)).toRecipients).toEqual([{ emailAddress: { address: 'co.jones@example.gov' } }]);
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/send|sendMail/.test(u))).toBe(false);
  });
});
