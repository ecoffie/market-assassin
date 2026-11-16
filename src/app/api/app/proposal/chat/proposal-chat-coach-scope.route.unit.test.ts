/**
 * Manual Drive (proposal chat) — Coach Mode binding (G1, 2026-11-16).
 *
 * The real /api/app/proposal/chat handler with auth, data and providers mocked. The Vault and
 * profile that ground a draft follow the same acting scope as Ask Mindy
 * (src/lib/chat/chat-acting-scope.ts):
 *  - client scope (authorized coach in a client workspace) → the CLIENT's Vault and profile;
 *  - unresolvable scope → an EMPTY Vault and profile, never the coach's own;
 *  - no header → the caller's own (unchanged);
 * and in every case the budget check and cost attribution stay on the caller (the coach).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const COACH = 'coach@firm.com';
const WS = '99999999-2222-4333-8444-555555555555';
const CLIENT_VAULT = `${WS}@clients.getmindy.ai`;

const state = vi.hoisted(() => ({
  resolve: 'client' as 'client' | 'own' | 'throw',
  profileEmails: [] as string[],
  vaultEmails: [] as string[],
  budgetEmails: [] as string[],
  usageEmails: [] as string[],
  sources: [] as string[],
  prompts: [] as string[],
  pursuit: null as Record<string, unknown> | null,
  tables: [] as string[],
}));

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: (_r: unknown, email: string) => ({ ok: true, session: { email } }),
}));
vi.mock('@/lib/access/require-pro', () => ({ isProEmail: async () => true, proRequiredResponse: () => new Response(null, { status: 402 }) }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: async () => ({ text: '' }) }));
vi.mock('@/lib/llm/usage-cost', () => ({
  isUserOverBudget: async (e: string) => { state.budgetEmails.push(e); return false; },
  recordLlmUsage: async (a: { userEmail?: string }) => { if (a?.userEmail) state.usageEmails.push(a.userEmail); },
}));
vi.mock('@/lib/proposal/loaders', () => ({
  loadBidderProfile: async (e: string) => { state.profileEmails.push(e); return { companyName: 'Loaded Co' }; },
  formatProfileForPrompt: () => '',
  loadVaultContext: async (e: string) => { state.vaultEmails.push(e); return { has_any: true, identity: { company_name: 'Loaded Co' } }; },
}));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: async () => [], formatChunksForPrompt: () => '' }));
vi.mock('@/lib/proposal/select-relevant', () => ({ selectRelevantRfp: () => '' }));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => {
    if (state.resolve === 'throw') throw new Error('db down');
    return state.resolve === 'client' ? { workspaceId: WS, asClient: true } : { workspaceId: 'own-ws', asClient: false };
  },
  clientNotificationEmail: (ws: string) => `${ws}@clients.getmindy.ai`,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      state.tables.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === 'user_pipeline' ? state.pursuit : null, error: null });
      q.then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === 'pursuit_documents' ? [{ filename: 'rfp.pdf', doc_kind: 'solicitation', extracted_text: 'TEXT', notice_id: null }] : [], error: null });
      return q;
    },
  }),
}));

beforeEach(() => {
  state.profileEmails = []; state.vaultEmails = []; state.budgetEmails = []; state.usageEmails = []; state.sources = [];
  state.prompts = []; state.pursuit = null; state.tables = [];
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    try { for (const m of JSON.parse(String(init?.body || '{}')).messages || []) state.prompts.push(String(m.content)); } catch { /* not JSON */ }
    return new Response(
    new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }),
    { status: 200 },
  );
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function ask(activeWorkspace: string | null, pipelineId?: string) {
  vi.resetModules();
  const { POST } = await import('./route');
  const headers: Record<string, string> = {};
  if (activeWorkspace) headers['x-active-workspace'] = activeWorkspace;
  const res = await POST(new Request('https://getmindy.ai/api/app/proposal/chat', {
    method: 'POST', headers, body: JSON.stringify({ email: COACH, message: 'Draft the technical approach.', rfpText: 'The contractor shall clean Building 12.', ...(pipelineId ? { pipeline_id: pipelineId } : {}) }),
  }) as never);
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'sources') state.sources.push(...ev.sources); } catch { /* not JSON */ }
  }
  return res;
}

describe('Manual Drive follows the acting scope', () => {
  it("client scope → the client's Vault and profile; budget stays on the coach", async () => {
    state.resolve = 'client';
    const res = await ask(WS);
    expect(res.status).toBe(200);
    expect(state.vaultEmails).toEqual([CLIENT_VAULT]);
    expect(state.profileEmails).toEqual([CLIENT_VAULT]);
    expect(state.budgetEmails).toEqual([COACH]);
    expect(state.usageEmails.every((e) => e === COACH)).toBe(true);
    expect(state.sources.join(' ')).toMatch(/This client's Vault/);
  });

  it("unresolvable scope → empty Vault and profile, never the coach's own", async () => {
    state.resolve = 'throw';
    const res = await ask(WS);
    expect(res.status).toBe(200);
    expect(state.vaultEmails).toEqual([]);
    expect(state.profileEmails).toEqual([]);
    expect(state.budgetEmails).toEqual([COACH]);
    expect(state.sources.join(' ')).not.toMatch(/Vault/);
  });

  it('own scope (no header) → the caller\'s own Vault and profile, as before', async () => {
    state.resolve = 'own';
    const res = await ask(null);
    expect(res.status).toBe(200);
    expect(state.vaultEmails).toEqual([COACH]);
    expect(state.profileEmails).toEqual([COACH]);
    expect(state.budgetEmails).toEqual([COACH]);
    expect(state.sources.join(' ')).toMatch(/Your Vault/);
  });

  it('an unauthorized header is ignored → own data (same as every screen)', async () => {
    state.resolve = 'own';
    await ask(WS);
    expect(state.vaultEmails).toEqual([COACH]);
    expect(state.profileEmails).toEqual([COACH]);
  });
});

describe('unresolvable workspace says so (U1)', () => {
  it("tells the model the workspace couldn't be confirmed — and never to fill in a Vault", async () => {
    state.resolve = 'throw';
    await ask(WS);
    const prompt = state.prompts.join('\n');
    expect(prompt).toContain("The active workspace couldn't be confirmed, so no Vault, profile or pursuit data was loaded. Ask the user to retry.");
    expect(prompt).toMatch(/Do NOT tell the user to add Vault or profile data/);
    expect(prompt).not.toMatch(/Vault is empty — tell the user what to add/);
  });

  it('own scope gets no workspace line', async () => {
    state.resolve = 'own';
    await ask(null);
    expect(state.prompts.join('\n')).not.toMatch(/couldn't be confirmed/);
  });
});

describe("client scope reads only the client's pursuits (N1-MD)", () => {
  const PID = '11111111-2222-4333-8444-555555555555';
  it("a coach's personal pursuit (authorizePursuitRead would allow it) → 404, no documents read", async () => {
    state.resolve = 'client';
    state.pursuit = { id: PID, user_email: COACH, workspace_id: 'coach-own-ws' };
    const res = await ask(WS, PID);
    expect(res.status).toBe(404);
    expect(state.tables).not.toContain('pursuit_documents');
    expect(state.vaultEmails).toEqual([]);
  });

  it("a pursuit in the client workspace → documents load and the client's Vault grounds the draft", async () => {
    state.resolve = 'client';
    state.pursuit = { id: PID, user_email: CLIENT_VAULT, workspace_id: WS };
    const res = await ask(WS, PID);
    expect(res.status).toBe(200);
    expect(state.tables).toContain('pursuit_documents');
    expect(state.vaultEmails).toEqual([CLIENT_VAULT]);
  });

  it('own scope: a personal pursuit still works (unchanged)', async () => {
    state.resolve = 'own';
    state.pursuit = { id: PID, user_email: COACH, workspace_id: null };
    const res = await ask(null, PID);
    expect(res.status).toBe(200);
    expect(state.tables).toContain('pursuit_documents');
  });
});

describe('unresolved workspace loads no pursuit data (U1-b)', () => {
  const PID = '11111111-2222-4333-8444-555555555555';
  it("a pursuit the coach owns: no user_pipeline / pursuit_documents read, and the note is present", async () => {
    state.resolve = 'throw';
    state.pursuit = { id: PID, user_email: COACH, workspace_id: null };
    const res = await ask(WS, PID);
    expect(res.status).toBe(200);
    expect(state.tables).not.toContain('pursuit_documents');
    expect(state.tables).not.toContain('user_pipeline');
    expect(state.prompts.join('\n')).toContain("The active workspace couldn't be confirmed, so no Vault, profile or pursuit data was loaded. Ask the user to retry.");
  });
});
