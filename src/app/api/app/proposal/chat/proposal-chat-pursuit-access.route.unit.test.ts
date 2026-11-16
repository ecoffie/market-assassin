/**
 * Proposal chat — pursuit access (2026-11-16).
 *
 * The real /api/app/proposal/chat handler with auth, data and providers mocked. Pins:
 *  - when a pipeline_id is sent, the pursuit must belong to the caller or their workspace
 *    BEFORE any pursuit document is read;
 *  - a pursuit the caller may not read answers exactly like a missing one (404);
 *  - the owner and a workspace member still get their documents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = 'pro@example.com';
const ID = '11111111-2222-4333-8444-555555555555';
const state: { pursuit: Record<string, unknown> | null; workspace: string; tables: string[] } = {
  pursuit: null, workspace: '', tables: [],
};

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: (_r: unknown, email: string) => ({ ok: true, session: { email } }),
}));
vi.mock('@/lib/access/require-pro', () => ({ isProEmail: async () => true, proRequiredResponse: () => new Response(null, { status: 402 }) }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: async () => ({ text: '' }) }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/proposal/loaders', () => ({
  loadBidderProfile: async () => null,
  formatProfileForPrompt: () => '',
  loadVaultContext: async () => ({ has_any: false }),
}));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: async () => [], formatChunksForPrompt: () => '' }));
vi.mock('@/lib/proposal/select-relevant', () => ({ selectRelevantRfp: () => '' }));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: state.workspace, asClient: false }),
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
  state.pursuit = null;
  state.workspace = '';
  state.tables = [];
  vi.stubEnv('OPENAI_API_KEY', 'ok');
  vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }),
    { status: 200 },
  )));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function ask(pipelineId: string) {
  vi.resetModules();
  const { POST } = await import('./route');
  return POST(new Request('https://getmindy.ai/api/app/proposal/chat', {
    method: 'POST', body: JSON.stringify({ email: ME, message: 'What does the RFP require?', pipeline_id: pipelineId }),
  }) as never);
}

describe('proposal chat pursuit access', () => {
  it('another user\'s pursuit → 404, and no pursuit document is read', async () => {
    state.pursuit = { id: ID, user_email: 'someone-else@example.com', workspace_id: null };
    const res = await ask(ID);
    expect(res.status).toBe(404);
    expect(state.tables).not.toContain('pursuit_documents');
  });

  it('a missing pursuit answers the same 404', async () => {
    const res = await ask(ID);
    expect(res.status).toBe(404);
    expect(state.tables).not.toContain('pursuit_documents');
  });

  it('a pursuit in another workspace → 404', async () => {
    state.pursuit = { id: ID, user_email: 'client@example.com', workspace_id: 'ws-a' };
    state.workspace = 'ws-b';
    expect((await ask(ID)).status).toBe(404);
    expect(state.tables).not.toContain('pursuit_documents');
  });

  it('the owner gets the pursuit documents', async () => {
    state.pursuit = { id: ID, user_email: ME, workspace_id: null };
    const res = await ask(ID);
    expect(res.status).toBe(200);
    await res.text();
    expect(state.tables).toContain('pursuit_documents');
  });

  it('a member of the pursuit workspace (e.g. an authorized coach) gets the documents', async () => {
    state.pursuit = { id: ID, user_email: 'client@example.com', workspace_id: 'ws-a' };
    state.workspace = 'ws-a';
    const res = await ask(ID);
    expect(res.status).toBe(200);
    await res.text();
    expect(state.tables).toContain('pursuit_documents');
  });
});
