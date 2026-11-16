/**
 * Manual Drive "solicitation facts" (Step 7, 2026-11-16).
 *
 * The real /api/app/proposal/chat handler. Pins: facts are recomputed from user_pipeline.notice_id with the
 * shared buyer/contact/incumbent functions, only AFTER pursuit access is granted; nothing is stored; a pursuit
 * with no notice, or a notice Mindy lacks, gets no block and the answer still streams.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ME = 'pro@example.com';
const ID = '11111111-2222-4333-8444-555555555555';
const NID = '1a02451bf3e04edf93f56216c2113d73';
const state: { pursuit: Record<string, unknown> | null; record: Record<string, unknown> | null; tables: string[]; writes: string[]; prompts: string[]; events: string } = {
  pursuit: null, record: null, tables: [], writes: [], prompts: [], events: '',
};

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: (_r: unknown, email: string) => ({ ok: true, session: { email } }) }));
vi.mock('@/lib/access/require-pro', () => ({ isProEmail: async () => true, proRequiredResponse: () => new Response(null, { status: 402 }) }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: async () => ({ text: '' }) }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: async () => null, formatProfileForPrompt: () => '', loadVaultContext: async () => ({ has_any: false }), ALL_VAULT_SECTIONS: ['identity', 'past_performance', 'capabilities', 'team'] }));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: async () => [], formatChunksForPrompt: () => '' }));
vi.mock('@/lib/proposal/select-relevant', () => ({ selectRelevantRfp: () => '' }));
vi.mock('@/lib/app/workspace', () => ({ resolveActiveWorkspace: async () => ({ workspaceId: '', asClient: false }) }));
vi.mock('@/lib/usaspending/solicitation-incumbent', async (orig) => ({
  ...(await orig<object>()),
  resolveSolicitationIncumbent: async () => ({
    queried: NID, notice: null, incumbent: null, summary: null,
    prior_awards: [{ recipientName: 'NORTHROP GRUMMAN', awardId: 'SPE8EN22F2859', naicsCode: '336413', pscCode: '7B22', popPotentialEnd: '2023-10-18' }],
    _meta: { grounded_notice: true, grounded_incumbent: false, degraded: false, notice_source: null, incumbent_finding: 'candidate_not_confirmed' },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      state.tables.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit']) q[m] = () => q;
      for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => { state.writes.push(table); return q; };
      q.maybeSingle = async () => ({ data: table === 'user_pipeline' ? state.pursuit : table === 'sam_opportunities' ? state.record : null, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return q;
    },
  }),
}));

const RECORD = {
  notice_id: NID, title: '70--INTERFACE UNIT,DATA', solicitation_number: 'SPRPA127RUA05', department: 'DEPT OF DEFENSE', sub_tier: 'DEFENSE LOGISTICS AGENCY',
  office: null, notice_type: 'Solicitation', set_aside_description: null, naics_code: '334111', psc_code: '7B22', posted_date: null,
  response_deadline: '2026-12-14T18:00:00+00:00', pop_city: null, pop_state: null, ui_link: null, active: true,
  agency_hierarchy: 'DEPT OF DEFENSE.DEFENSE LOGISTICS AGENCY.DLA AVIATION.DLA AVIATION AT PHILADELPHIA, PA',
  office_address: { city: 'PHILADELPHIA', state: 'PA' },
  points_of_contact: [{ type: 'primary', fullName: 'Telephone: 2157373861', email: 'KELI.BARISH@DLA.MIL' }],
};

beforeEach(() => {
  Object.assign(state, { pursuit: { id: ID, user_email: ME, workspace_id: null, notice_id: NID }, record: RECORD, tables: [], writes: [], prompts: [], events: '' });
  vi.stubEnv('OPENAI_API_KEY', 'ok'); vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    state.prompts.push(b.messages.map((m: { content: string }) => m.content).join('\n'));
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }), { status: 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ask(body: Record<string, unknown> = { pipeline_id: ID }) {
  vi.resetModules();
  const { POST } = await import('./route');
  const res = await POST(new Request('https://getmindy.ai/api/app/proposal/chat', { method: 'POST', body: JSON.stringify({ email: ME, message: 'Who do I send questions to?', ...body }) }) as never);
  state.events = res.status === 200 ? await res.text() : '';
  return res;
}

describe('Manual Drive solicitation facts', () => {
  it('owner pursuit with a notice → the facts block (buyer, DoDAAC, contact, incumbent as stated) and a source line', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    const p = state.prompts[0];
    expect(p).toContain('SOLICITATION FACTS (recomputed by Mindy from SAM.gov notice SPRPA127RUA05');
    expect(p).toContain('Buying office: DLA AVIATION AT PHILADELPHIA, PA (PHILADELPHIA, PA)');
    expect(p).toContain('Office DoDAAC: SPRPA1');
    expect(p).toContain('Notice point of contact: KELI.BARISH@DLA.MIL, 2157373861');
    expect(p).toContain('Finding: candidate_not_confirmed');
    expect(p).toContain('NOT identified as the incumbent');
    expect(p).toContain('State the incumbent ONLY as the finding says');
    expect(state.events).toContain('Solicitation facts (SAM.gov notice SPRPA127RUA05, buyer and incumbent lookup)');
  });

  it('nothing is written (facts are recomputed, never stored)', async () => {
    await ask();
    expect(state.writes).toEqual([]);
  });

  it('another user\'s pursuit → 404 before the notice or facts are read', async () => {
    state.pursuit = { id: ID, user_email: 'someone-else@example.com', workspace_id: null, notice_id: NID };
    const res = await ask();
    expect(res.status).toBe(404);
    expect(state.tables).not.toContain('sam_opportunities');
    expect(state.prompts).toEqual([]);
  });

  it('a pursuit without a notice → no facts block, no notice read, answer still streams', async () => {
    state.pursuit = { id: ID, user_email: ME, workspace_id: null, notice_id: null };
    const res = await ask();
    expect(res.status).toBe(200);
    expect(state.tables).not.toContain('sam_opportunities');
    expect(state.prompts[0]).not.toContain('SOLICITATION FACTS (recomputed');
  });

  it('a notice Mindy does not have → no block (never a guessed record), answer still streams', async () => {
    state.record = null;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(state.prompts[0]).not.toContain('SOLICITATION FACTS (recomputed');
  });

  it('no pipeline_id (uploaded RFP text only) → no facts lookup at all', async () => {
    await ask({ rfpText: 'Section L ...' });
    expect(state.tables).not.toContain('sam_opportunities');
    expect(state.tables).not.toContain('user_pipeline');
  });
});
