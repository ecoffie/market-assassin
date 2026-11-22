/**
 * "A professional report with sections X, Y, Z" through the REAL chat route (Claude Local repro, 2026-11-22).
 *
 * Prompt (fresh Map chat, second turn): "Turn this research into a professional market intelligence report with
 * an executive summary, agency analysis, opportunity pipeline, incumbent research, risks, recommended actions
 * and sources." Production produced the PACKAGED generate_market_report twice (fixed template: no executive
 * summary, risks, actions or sources) while the chat answer carried them.
 *
 *   - Research already in the chat + create_document available: the packaged report is not offered,
 *     create_document is forced, the planner gets the research and the section list, and the saved DocModel
 *     carries every requested section, or the answer is told plainly which could not be filled.
 *   - First turn (no research yet) or no document tool: the packaged report may run, and the answer is told to say
 *     plainly which requested sections it does not include (never presented as the requested report).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({ saved: [] as Array<Record<string, unknown>>, runMcpTool: vi.fn() }));

vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) chain[m] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  chain.storage = { from: () => ({}) };
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: vi.fn(async () => ({})), loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/tool-registry')>()), runMcpTool: h.runMcpTool }));
vi.mock('@/lib/pdf/launch-browser', () => ({ htmlToPdf: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.7 test'), error: null })) }));
vi.mock('@/lib/vault/generated', async (orig) => ({
  ...(await orig<typeof import('@/lib/vault/generated')>()),
  saveGeneratedDocument: vi.fn(async (input: Record<string, unknown>) => {
    h.saved.push(input);
    return { ok: true, version: 1, ownerEmail: 'erika@example.com', document: { id: `00000000-0000-4000-8000-00000000000${h.saved.length}`, original_filename: `Report.${input.format}` } };
  }),
}));

const ASK = 'Turn this research into a professional market intelligence report with an executive summary, agency analysis, opportunity pipeline, incumbent research, risks, recommended actions and sources.';
const PRIOR_RESEARCH = [
  { role: 'user', content: 'Research the VA healthcare construction market in Georgia.' },
  { role: 'assistant', content: 'VA obligated $412.5M for construction in Georgia in FY2025 (USAspending). Top buyer: VISN 7. Incumbent on the Augusta MATOC: Acme Builders, ending March 2027. Open notice 36C24726R0001 (SAM.gov) is a sources sought for Augusta renovations.' },
];

// What a planner sends when it follows the sectioned-report note: every requested section, cited.
const SRC = [
  { id: 's1', kind: 'usaspending', label: 'USAspending, VA construction obligations, Georgia FY2025', url: 'https://www.usaspending.gov/search' },
  { id: 's2', kind: 'sam_notice', label: 'SAM.gov notice 36C24726R0001', url: 'https://sam.gov/opp/36C24726R0001/view' },
];
const para = (id: string, text: string, claim: string, cites?: string[], extra: Record<string, unknown> = {}) => ({ type: 'paragraph', id, text, claim, ...(cites ? { cites } : {}), ...extra });
const FULL_REPORT = { doc_model: { title: 'VA Healthcare Construction, Georgia: Market Intelligence Report', sources: SRC, sections: [
  { id: 'sec-exec', heading: 'Executive summary', blocks: [para('e1', 'VA obligated $412.5M for construction in Georgia in FY2025.', 'fact', ['s1'])] },
  { id: 'sec-agency', heading: 'Agency analysis', blocks: [para('a1', 'VISN 7 is the top buyer.', 'fact', ['s1'])] },
  { id: 'sec-pipe', heading: 'Opportunity pipeline', blocks: [para('o1', 'A sources sought for Augusta renovations is open.', 'fact', ['s2'])] },
  { id: 'sec-inc', heading: 'Incumbent research', blocks: [para('i1', 'Acme Builders holds the Augusta MATOC through March 2027.', 'fact', ['s1'])] },
  { id: 'sec-risk', heading: 'Risks', blocks: [para('r1', 'Staffing costs could rise faster than planned.', 'assumption', undefined, { origin: 'Planning premise; not verified.' })] },
  { id: 'sec-act', heading: 'Recommended actions', blocks: [para('c1', 'Respond to the Augusta sources sought.', 'recommendation', ['s2'])] },
] } };

let plannerArgs: unknown = FULL_REPORT;
let plannerBody: Record<string, unknown> | null = null;
const plannerSystems: string[] = [];
const answerSystems: string[] = [];
const toolResults: string[] = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
  vi.stubEnv('VAULT_DOC_ALLOWLIST', 'erika@example.com');
  h.saved.length = 0;
  plannerSystems.length = 0; answerSystems.length = 0; toolResults.length = 0;
  plannerArgs = FULL_REPORT; plannerBody = null;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async () => ({ result: { ok: true, report_id: 'r1', url: 'https://getmindy.ai/reports/x', title: 'Market report', html: '<html></html>' }, credits: 0 }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown> & { messages?: Array<{ role: string; content?: string }> };
    if (isPlannerCall(body)) {
      plannerBody ??= body;
      for (const m of body.messages ?? []) if (m.role === 'system' && m.content) plannerSystems.push(m.content);
      // plannerArgs null = the planner picks the packaged report (what production did)
      return plannerResponse([plannerArgs === null ? { name: 'generate_market_report', args: { keyword: 'construction', state: 'GA' } } : { name: 'create_document', args: plannerArgs }]);
    }
    for (const m of body.messages ?? []) {
      if (m.role === 'system' && m.content) answerSystems.push(m.content);
      if (m.role === 'tool' && m.content) toolResults.push(m.content);
    }
    return answerStream(['Here is your report.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function ask(history: unknown[]) {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withinMs(readSse(await POST(chatRequest({ message: ASK, history }) as any)), 8000, 'chat stream');
  const tools = ((plannerBody?.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
  return { tools, toolChoice: JSON.stringify(plannerBody?.tool_choice ?? '') };
}
const headings = () => (h.saved[0].docModel as { sections: Array<{ heading: string }> }).sections.map((s) => s.heading);

describe('sectioned report request (Claude Local repro)', () => {
  it('research in the chat: the packaged report is not offered, create_document is forced with the research and the section list', async () => {
    const r = await ask(PRIOR_RESEARCH);
    expect(r.tools).not.toContain('generate_market_report');
    expect(r.tools).toContain('create_document');
    expect(r.toolChoice).toContain('create_document');
    const sys = plannerSystems.join('\n');
    expect(sys).toContain('SECTIONED REPORT: the customer asked for a report with these sections: Executive summary, Risks, Actions, Sources, Agency analysis, Opportunity pipeline, Incumbent research.');
    // the planner sees the research it must build from (the latest answer)
    const msgs = (plannerBody!.messages as Array<{ role: string; content: string }>);
    expect(msgs.some((m) => m.role === 'assistant' && m.content.includes('Acme Builders'))).toBe(true);
    expect(h.runMcpTool).not.toHaveBeenCalledWith('generate_market_report', expect.anything(), expect.anything());
  });

  it('the saved DocModel includes every requested section, with sources', async () => {
    await ask(PRIOR_RESEARCH);
    expect(headings()).toEqual(['Executive summary', 'Agency analysis', 'Opportunity pipeline', 'Incumbent research', 'Risks', 'Recommended actions']);
    const res = toolResults.find((t) => t.includes('requested_sections'))!;
    expect(JSON.parse(res).requested_sections).toEqual({
      requested: ['executive_summary', 'risks', 'actions', 'sources', 'Agency analysis', 'Opportunity pipeline', 'Incumbent research'],
      added: [], missing: [],
    });
    const saved = h.saved[0].docModel as { sources: Array<{ id: string }> };
    expect(saved.sources.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('a planner document missing some sections: the ones it can are completed from its own statements, the rest are named plainly to the answer', async () => {
    plannerArgs = { doc_model: { ...FULL_REPORT.doc_model, sections: FULL_REPORT.doc_model.sections.filter((s) => !['sec-exec', 'sec-inc'].includes(s.id)) } };
    await ask(PRIOR_RESEARCH);
    expect(headings()[0]).toBe('Executive summary');
    const res = JSON.parse(toolResults.find((t) => t.includes('requested_sections'))!);
    expect(res.requested_sections.added).toEqual(['executive_summary']);
    expect(res.requested_sections.missing).toEqual(['Incumbent research']);
    expect(res.note).toMatch(/asked for Incumbent research in the document, but it is NOT in the saved file\. Say so plainly/);
  });

  it('first turn (no research yet): the packaged report may run, and the answer must say plainly which requested sections it lacks', async () => {
    plannerArgs = null;
    const r = await ask([]);
    expect(r.tools).toContain('generate_market_report');
    expect(r.toolChoice).not.toContain('create_document');
    const note = answerSystems.find((s) => s.startsWith('REQUESTED SECTIONS NOT IN THE PACKAGED REPORT'))!;
    expect(note).toContain('Executive summary, Risks, Actions, Sources, Opportunity pipeline, Incumbent research');
    expect(note).toMatch(/never present it as the report they asked for/);
    expect(note).toMatch(/Offer, as the next step, to turn this research into a document/);
    expect(h.saved).toEqual([]);
  });

  it('document tool not available for this caller: the packaged report path, with the plain gap note', async () => {
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'someone-else@example.com');
    plannerArgs = null;
    const r = await ask(PRIOR_RESEARCH);
    expect(r.tools).not.toContain('create_document');
    expect(answerSystems.join('\n')).toMatch(/REQUESTED SECTIONS NOT IN THE PACKAGED REPORT[\s\S]*the full report with those sections cannot be produced as a file/);
  });
});
