/**
 * create_document through the REAL /api/app/chat route and the real tool executor — the path that failed in
 * the 2026-11-17 production test (eric@, allowlist on): the model guessed a source kind ("uploaded_file"),
 * the engine called it structural, and every call was refused; the retry that would have repaired it needs
 * a second tool round that Ask Mindy never runs.
 *
 * Only auth, the Vault save, the PDF browser and the providers are faked. The planner returns ONE realistic
 * create_document call in ONE round; the document must be saved on that call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs, type SseEvent } from './__fixtures__/route-harness';

const h = vi.hoisted(() => ({
  saved: [] as Array<Record<string, unknown>>,
}));

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
vi.mock('@/lib/pdf/launch-browser', () => ({ htmlToPdf: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.7 test'), error: null })) }));
vi.mock('@/lib/vault/generated', async (orig) => ({
  ...(await orig<typeof import('@/lib/vault/generated')>()),
  saveGeneratedDocument: vi.fn(async (input: Record<string, unknown>) => {
    h.saved.push(input);
    return { ok: true, version: 1, ownerEmail: 'erika@example.com', document: { id: `00000000-0000-4000-8000-00000000000${h.saved.length}`, original_filename: `Capability-Statement.${input.format}` } };
  }),
}));

// What a model actually sent in the live test: a guessed source kind, and one uncited fact.
const LIVE_LIKE_ARGS = {
  doc_model: {
    title: 'Capability Statement',
    sources: [{ id: 's1', kind: 'uploaded_file', label: 'Capability statement draft (uploaded)' }],
    sections: [{ id: 'core', heading: 'Core competencies', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Facilities maintenance and janitorial services for federal buildings.', claim: 'fact', cites: ['s1'] },
      { type: 'paragraph', id: 'p2', text: 'Our crews average a 98% inspection pass rate.', claim: 'fact' },
    ] }],
  },
};

let plannerArgs: unknown = LIVE_LIKE_ARGS;
const toolResultsSeen: string[] = [];
const plannerSystems: string[] = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
  vi.stubEnv('VAULT_DOC_ALLOWLIST', 'erika@example.com');
  h.saved.length = 0;
  toolResultsSeen.length = 0;
  plannerSystems.length = 0;
  plannerArgs = LIVE_LIKE_ARGS;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as { messages?: Array<{ role: string; content?: string }> };
    if (isPlannerCall(body as Record<string, unknown>)) {
      for (const m of body.messages ?? []) if (m.role === 'system' && m.content) plannerSystems.push(m.content);
      return plannerResponse([{ name: 'create_document', args: plannerArgs }]);
    }
    for (const m of body.messages ?? []) if (m.role === 'tool' && m.content) toolResultsSeen.push(m.content);
    return answerStream(['Your capability statement is saved to your Vault.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function ask(message: string): Promise<SseEvent[]> {
  const { POST } = await import('./route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(chatRequest({ message }) as any);
  return withinMs(readSse(res), 8000, 'chat stream');
}

describe('create_document through the real chat route', () => {
  it('ONE tool round with a guessed source kind and an uncited fact → Word + PDF saved on that call', async () => {
    const events = await ask('Create my improved capability statement as a document');
    expect(h.saved.map((s) => s.format)).toEqual(['docx', 'pdf']);
    const model = h.saved[0].docModel as { sources: Array<{ kind: string }>; theme: string; sections: Array<{ blocks: Array<{ id: string; claim: string }> }> };
    expect(model.sources[0].kind).toBe('upload');
    expect(model.theme).toBe('mindy');
    expect(model.sections[0].blocks.map((b) => [b.id, b.claim])).toEqual([['p1', 'fact'], ['p2', 'unverified']]);
    expect(toolResultsSeen.join(' ')).toMatch(/"ok":true/);
    // W2: client download chips — document ids only (no signed URLs on the wire).
    const deliverables = events.find((e) => e.type === 'deliverables') as SseEvent & {
      files?: Array<{ format: string; document_id: string; file_name?: string }>;
      pdf_note?: string;
    };
    expect(deliverables?.files?.map((f) => f.format)).toEqual(['docx', 'pdf']);
    expect(deliverables?.files?.every((f) => /^[0-9a-f-]{36}$/i.test(f.document_id))).toBe(true);
    expect(JSON.stringify(deliverables)).not.toMatch(/https?:\/\//);
  });

  it('a truly unknown kind is refused with the allowed values (nothing saved), visible to the answer model', async () => {
    plannerArgs = { doc_model: { ...LIVE_LIKE_ARGS.doc_model, sources: [{ id: 's1', kind: 'press_release', label: 'x' }] } };
    await ask('Create my capability statement as a document');
    expect(h.saved).toEqual([]);
    expect(toolResultsSeen.join(' ')).toMatch(/allowed values: sam_notice, usaspending, upload, vault, tool, web, other/);
  });

  it('not allowlisted → the tool is not offered and nothing is saved', async () => {
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'someone-else@example.com');
    await ask('Create my capability statement as a document');
    expect(h.saved).toEqual([]);
  });

  it('requested sections (Claude Local 2026-11-22): the planner is told, and the saved DocModel carries them, with sources', async () => {
    plannerArgs = { doc_model: {
      title: 'VA Janitorial Brief',
      sources: [{ id: 's1', kind: 'usaspending', label: 'USAspending award', url: 'https://www.usaspending.gov/award/CONT_AWD_X' }],
      sections: [{ id: 'core', heading: 'Where demand is', blocks: [
        { type: 'paragraph', id: 'p1', text: 'VA obligated $412.5M for janitorial services.', claim: 'fact', cites: ['s1'] },
        { type: 'paragraph', id: 'p2', text: 'Staffing costs could rise faster than planned.', claim: 'assumption', origin: 'Planning premise; not verified.' },
        { type: 'paragraph', id: 'p3', text: 'Call the VA contracting office this month.', claim: 'recommendation' },
      ] }],
    } };
    await ask('Create a PDF report with an executive summary, risks, actions and sources');
    expect(plannerSystems.join('\n')).toContain('REQUESTED DOCUMENT SECTIONS: the customer asked the document itself to include: Executive summary, Risks, Actions, Sources.');
    const model = h.saved[0].docModel as { sections: Array<{ heading: string }> };
    expect(model.sections.map((x) => x.heading)).toEqual(['Executive summary', 'Where demand is', 'Risks', 'Actions']);
    expect(toolResultsSeen.join(' ')).toMatch(/"requested_sections":\{"requested":\["executive_summary","risks","actions","sources"\],"added":\["executive_summary","risks","actions"\],"missing":\[\]\}/);
  });

  it('no sections named: no requested-sections note and the model is saved as sent', async () => {
    await ask('Create my improved capability statement as a document');
    expect(plannerSystems.join('\n')).not.toContain('REQUESTED DOCUMENT SECTIONS');
    expect((h.saved[0].docModel as { sections: Array<{ heading: string }> }).sections.map((x) => x.heading)).toEqual(['Core competencies']);
  });
});
