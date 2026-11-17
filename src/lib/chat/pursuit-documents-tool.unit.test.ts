/**
 * search_my_pursuit_documents — Ask Mindy's owner-checked pursuit-document read.
 *
 * Merge-blocking: private documents need (1) the Vault routes' strong auth, (2) the
 * ownership decision (authorizePursuitRead), and (3) only question-relevant excerpts,
 * never whole files. Fixture text only — no customer documents.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeTier0Tools, TIER0_TOOL_DEFS, type Tier0Db, type PursuitDocsReader } from './tier0-tools';
import { selectPursuitDocExcerpts, questionTerms, EXCERPT_CHARS, MAX_EXCERPTS } from '@/lib/proposal/pursuit-doc-excerpts';
import { chatToolPolicy } from './chat-tool-policy';

vi.mock('@/lib/proposal/loaders', () => ({ loadVaultContext: vi.fn() }));

const PID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';

const RFP = [
  'SECTION L — INSTRUCTIONS TO OFFERORS',
  'Volume I, the Technical Volume, shall not exceed 25 pages. Pages beyond the limit will not be evaluated.',
  'SECTION M — EVALUATION FACTORS',
  'Award will be made on a best value tradeoff basis. Technical approach is more important than past performance.',
  'Past performance references must be within the last five years and relevant in size and scope.',
  'SECTION C — PERFORMANCE WORK STATEMENT',
  'The contractor shall provide custodial services for Building 12 five days per week.',
].join('\n\n');
const SECRET_TAIL = 'UNRELATED-CLAUSE-THAT-MUST-NOT-LEAK '.repeat(80);
const fixtureDocs = [
  { filename: 'RFP.pdf', doc_kind: 'solicitation', extracted_text: `${RFP}\n\n${SECRET_TAIL}` },
  { filename: 'QA.pdf', doc_kind: 'qa', extracted_text: 'Q1: Is the page limit for the technical volume inclusive of the cover? A: No, cover pages are excluded from the page limit.' },
];

function stubDb(rows: Array<Record<string, unknown>>, captured: Array<[string, string]> = []): Tier0Db {
  const chain: Record<string, unknown> = {};
  chain.eq = (c: string, v: string) => { captured.push([c, v]); return chain; };
  chain.order = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return { from: () => ({ select: () => chain }) } as unknown as Tier0Db;
}

function reader(allow: Set<string>, docs = fixtureDocs): PursuitDocsReader & { authorize: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> } {
  return {
    authorize: vi.fn(async (id: string) => (allow.has(id) ? { ok: true as const } : { ok: false as const, reason: 'not_found' as const })),
    load: vi.fn(async () => ({ data: docs, error: null })),
  };
}

const tools = (r: PursuitDocsReader | undefined, strongAuth: boolean, rows: Array<Record<string, unknown>> = [], captured?: Array<[string, string]>) =>
  makeTier0Tools(stubDb(rows, captured), 'owner@x.com', vi.fn() as never, { pursuitDocs: r, strongAuth });

describe('search_my_pursuit_documents — definition and policy', () => {
  it('is a chat-private READ tool with no identity argument', () => {
    const def = TIER0_TOOL_DEFS.find((d) => d.function.name === 'search_my_pursuit_documents')!;
    expect(Object.keys(def.function.parameters.properties)).toEqual(['pursuit', 'question']);
    expect(def.function.parameters.additionalProperties).toBe(false);
    expect(chatToolPolicy('search_my_pursuit_documents', true).decision).toBe('allowed_read');
  });
});

describe('access', () => {
  it('without strong auth it reads nothing', async () => {
    const r = reader(new Set([PID]));
    const out = await tools(r, false).execute('search_my_pursuit_documents', { pursuit: PID, question: 'page limit' });
    expect(out).toMatchObject({ ok: false, error: 'strong_auth_required' });
    expect(r.authorize).not.toHaveBeenCalled();
    expect(r.load).not.toHaveBeenCalled();
  });

  it("someone else's pursuit: authorize denies, documents are never loaded, same answer as a missing id", async () => {
    const r = reader(new Set([PID]));
    const other = await tools(r, true).execute('search_my_pursuit_documents', { pursuit: OTHER, question: 'page limit' });
    expect(r.authorize).toHaveBeenCalledWith(OTHER);
    expect(r.load).not.toHaveBeenCalled();
    expect(other).toMatchObject({ ok: false, error: 'pursuit_not_found' });
  });

  it('an authorize error is not reported as "no documents"', async () => {
    const r = reader(new Set());
    r.authorize.mockResolvedValueOnce({ ok: false, reason: 'error' });
    const out = await tools(r, true).execute('search_my_pursuit_documents', { pursuit: PID, question: 'page limit' });
    expect(out).toMatchObject({ ok: false, error: 'pursuit_unavailable' });
  });

  it('a title reference resolves within the bound user\'s pipeline, then still goes through authorize', async () => {
    const r = reader(new Set([PID]));
    const captured: Array<[string, string]> = [];
    const rows = [{ id: PID, title: 'Fort Bragg Custodial Services', agency: 'Army' }, { id: OTHER, title: 'Navy Fuel Delivery', agency: 'DLA' }];
    const out = await tools(r, true, rows, captured).execute('search_my_pursuit_documents', { pursuit: 'Fort Bragg custodial', question: 'page limit' });
    expect(captured).toContainEqual(['user_email', 'owner@x.com']);
    expect(r.authorize).toHaveBeenCalledWith(PID);
    expect(out).toMatchObject({ ok: true, count: expect.any(Number) });
  });

  it('an ambiguous title asks which one and reads nothing', async () => {
    const r = reader(new Set([PID, OTHER]));
    const rows = [{ id: PID, title: 'Custodial Services East', agency: 'Army' }, { id: OTHER, title: 'Custodial Services West', agency: 'Army' }];
    const out = await tools(r, true, rows).execute('search_my_pursuit_documents', { pursuit: 'custodial services', question: 'page limit' });
    expect(out).toMatchObject({ ok: false, error: 'pursuit_ambiguous' });
    expect((out.candidates as unknown[]).length).toBe(2);
    expect(r.load).not.toHaveBeenCalled();
  });
});

describe('excerpts, not files', () => {
  it('returns the passages that answer the question, bounded, and never the unrelated remainder', async () => {
    const r = reader(new Set([PID]));
    const out = await tools(r, true).execute('search_my_pursuit_documents', { pursuit: PID, question: 'What is the page limit for the technical volume?' });
    const excerpts = out.excerpts as Array<{ filename: string; text: string }>;
    expect(excerpts.length).toBeGreaterThan(0);
    expect(excerpts.length).toBeLessThanOrEqual(MAX_EXCERPTS);
    expect(excerpts.every((e) => e.text.length <= EXCERPT_CHARS)).toBe(true);
    expect(excerpts.some((e) => /25 pages/.test(e.text))).toBe(true);
    expect(JSON.stringify(out)).not.toContain('UNRELATED-CLAUSE-THAT-MUST-NOT-LEAK');
    expect(JSON.stringify(out).length).toBeLessThan(RFP.length + SECRET_TAIL.length);
  });

  it('no matching passage → zero excerpts and an honest note (no filler text)', async () => {
    const r = reader(new Set([PID]));
    const out = await tools(r, true).execute('search_my_pursuit_documents', { pursuit: PID, question: 'cybersecurity maturity certification' });
    expect(out).toMatchObject({ ok: true, count: 0, excerpts: [] });
    expect(String(out.note)).toMatch(/No passage/);
  });

  it('no stored text → says so, does not claim the pursuit has no documents at SAM', async () => {
    const r = reader(new Set([PID]), []);
    const out = await tools(r, true).execute('search_my_pursuit_documents', { pursuit: PID, question: 'page limit' });
    expect(out).toMatchObject({ ok: true, document_count: 0, count: 0 });
  });

  it('ranks the passage matching more question terms first', () => {
    const { excerpts } = selectPursuitDocExcerpts(fixtureDocs, 'past performance references years');
    expect(excerpts[0].text).toMatch(/Past performance references/);
  });

  it('drops filler words from the question', () => {
    expect(questionTerms('What does the RFP say about the page limit?')).toEqual(['page', 'limit']);
  });
});

describe('acting scope (N1): a client workspace reads only its own pursuits', () => {
  const WS = '99999999-2222-3333-4444-555555555555';
  const clientScope = { kind: 'client' as const, email: 'coach@firm.com', workspaceId: WS, vaultEmail: `${WS}@clients.getmindy.ai` };
  // Stub: a pursuit row exists in the client workspace only when its id is in `inWs`.
  function scopedDb(inWs: Set<string>, captured: Array<[string, string]> = []): Tier0Db {
    const make = () => {
      const f: Array<[string, string]> = [];
      const chain: Record<string, unknown> = {};
      chain.eq = (c: string, v: string) => { f.push([c, v]); captured.push([c, v]); return chain; };
      chain.order = () => chain;
      chain.limit = async () => {
        const ws = f.find(([c]) => c === 'workspace_id')?.[1];
        const id = f.find(([c]) => c === 'id')?.[1];
        return { data: ws === WS && id && inWs.has(id) ? [{ id }] : [], error: null };
      };
      return chain;
    };
    return { from: () => ({ select: () => make() }) } as unknown as Tier0Db;
  }

  it("a pursuit the coach owns personally (authorize would allow it) is NOT readable from the client workspace", async () => {
    const r = reader(new Set([OTHER])); // authorize allows the coach's own pursuit
    const out = await makeTier0Tools(scopedDb(new Set([PID])), clientScope, vi.fn() as never, { pursuitDocs: r, strongAuth: true })
      .execute('search_my_pursuit_documents', { pursuit: OTHER, question: 'page limit' });
    expect(out).toMatchObject({ ok: false, error: 'pursuit_not_found' });
    expect(r.authorize).not.toHaveBeenCalled();
    expect(r.load).not.toHaveBeenCalled();
  });

  it("a pursuit in the client workspace passes the scope check, then still goes through authorize", async () => {
    const r = reader(new Set([PID]));
    const captured: Array<[string, string]> = [];
    const out = await makeTier0Tools(scopedDb(new Set([PID]), captured), clientScope, vi.fn() as never, { pursuitDocs: r, strongAuth: true })
      .execute('search_my_pursuit_documents', { pursuit: PID, question: 'page limit' });
    expect(captured).toEqual(expect.arrayContaining([['workspace_id', WS], ['id', PID]]));
    expect(r.authorize).toHaveBeenCalledWith(PID);
    expect(out).toMatchObject({ ok: true, workspace: 'client' });
  });
});

describe('whole-word matching (N2)', () => {
  it('"fire" matches fire/fires, never firearm', () => {
    const docs = [{ filename: 'a.pdf', extracted_text: 'Firearms qualification is required for all guards.' },
      { filename: 'b.pdf', extracted_text: 'Fire alarm testing is required quarterly. Fires must be reported.' }];
    const { excerpts } = selectPursuitDocExcerpts(docs, 'fire alarm');
    expect(excerpts.map((e) => e.filename)).toEqual(['b.pdf']);
    expect(selectPursuitDocExcerpts([docs[0]], 'fire').excerpts).toEqual([]);
  });
});
