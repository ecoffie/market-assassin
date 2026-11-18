/**
 * create_document — DocModel → PDF + Word, saved to the acting scope's Vault as generated rows.
 * Fake db/storage/renderer (no network). Proves: per-caller flag (off / allowlist), default theme,
 * retry-then-label, boilerplate retry, assumptions never harden on revision, revisions are new
 * versions (never overwrite), workspace isolation, fixture and CUI refusal, honest PDF failure,
 * and that the tool is non-billable (never offered in the billed card chat).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeGenerateDocumentTool, CREATE_DOCUMENT, CREATE_DOCUMENT_TOOL_DEF } from './generate-document-tool';
import { SOURCE_KIND_VALUES, BLOCK_TYPE_VALUES, CLAIM_VALUES } from '@/lib/documents/validate';
import { CARD_CHAT_TOOLS } from './card-chat';
import { chatToolPolicy } from './chat-tool-policy';
import { VAULT_GROUNDED_TOOLS } from './chat-tool-executor';

const ME = 'erika@example.com';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
function fakeDb(tables: Record<string, R[]>) {
  return {
    from(t: string) {
      const filters: Array<(r: R) => boolean> = [];
      let lim = Infinity;
      let inserting: R | null = null;
      const run = async (one: boolean) => {
        if (inserting) { const r = { id: uuid(), archived_at: null, ...inserting }; (tables[t] ||= []).push(r); return { data: r, error: null }; }
        const rows = (tables[t] || []).filter((r) => filters.every((f) => f(r))).slice(0, lim);
        return { data: one ? rows[0] ?? null : rows, error: null };
      };
      const api: R = {
        select: () => api,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return api; },
        order: () => api,
        limit: (n: number) => { lim = n; return api; },
        insert: (row: R) => { inserting = row; return api; },
        maybeSingle: () => run(true),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run(false).then(res, rej),
      };
      return api;
    },
  };
}
function fakeStorage() {
  const blobs: string[] = [];
  return {
    blobs,
    listBuckets: async () => ({ data: [{ name: 'vault-assets' }], error: null }),
    createBucket: async () => ({ data: null, error: null }),
    from: () => ({ upload: async (p: string) => { blobs.push(p); return { error: null }; }, remove: async () => ({ error: null }) }),
  };
}

const model = (over: R = {}) => ({
  title: 'Janitorial Market Brief',
  sources: [{ id: 's1', kind: 'usaspending', label: 'USAspending award data', url: 'https://www.usaspending.gov/search' }],
  sections: [{ id: 'a', heading: 'Summary', blocks: [{ type: 'paragraph', id: 'p1', text: 'VA obligated $412.5M for janitorial services.', claim: 'fact', cites: ['s1'] }] }],
  ...over,
});

function setup(opts: { scope?: R; rows?: R[]; pdfDegraded?: boolean } = {}) {
  const tables: Record<string, R[]> = { user_boilerplate_docs: opts.rows ?? [], mindy_chat_sessions: [] };
  const storage = fakeStorage();
  const renders: Array<{ format: string; model: R }> = [];
  const tool = makeGenerateDocumentTool({
    db: fakeDb(tables) as never,
    storage: storage as never,
    scope: (opts.scope ?? { kind: 'own', email: ME }) as never,
    callerEmail: ME,
    request: { headers: { get: () => null } },
    chatSessionId: null,
    today: () => '2026-11-17',
    render: (async (m: R, format: string) => {
      renders.push({ format, model: m });
      if (format === 'pdf' && opts.pdfDegraded) return { ok: true, format: 'html', bytes: Buffer.from('<html>'), mime: 'text/html', filename: 'x.html', degraded: { requested: 'pdf', reason: 'no browser' } };
      return { ok: true, format, bytes: Buffer.from(`%${format}`), mime: format, filename: `Janitorial-Market-Brief.${format}`, degraded: null };
    }) as never,
  });
  const docs = () => tables.user_boilerplate_docs;
  return { tool, tables, storage, renders, docs };
}

beforeEach(() => { vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist'); vi.stubEnv('VAULT_DOC_ALLOWLIST', ME); });
afterEach(() => vi.unstubAllEnvs());

describe('create_document', () => {
  it('not allowlisted (or off) behaves exactly like off: nothing rendered, read or saved', async () => {
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'someone-else@example.com');
    const s = setup();
    expect(await s.tool.execute({ doc_model: model() })).toMatchObject({ ok: false, error: 'not_available' });
    vi.stubEnv('VAULT_GENERATED_FILES', '');
    expect(await s.tool.execute({ doc_model: model() })).toMatchObject({ ok: false, error: 'not_available' });
    expect(s.renders).toEqual([]);
    expect(s.docs()).toEqual([]);
    expect(s.storage.blobs).toEqual([]);
  });

  it('allowlisted: saves a Word and a PDF as generated v1 rows in the caller\'s Vault, theme mindy by default', async () => {
    const s = setup();
    const r = await s.tool.execute({ doc_model: model() });
    expect(r).toMatchObject({ ok: true, saved_to: 'vault', version: 1 });
    expect((r.files as R[]).map((f) => f.format)).toEqual(['docx', 'pdf']);
    expect((r.files as R[])[0].download_path).toMatch(/^\/api\/app\/vault\/documents\/download\?id=/);
    expect(s.docs()).toHaveLength(2);
    for (const d of s.docs()) expect(d).toMatchObject({ user_email: ME, doc_class: 'generated', source: 'ask_mindy', version: 1, parent_id: null });
    expect(s.docs()[0].doc_model).toMatchObject({ theme: 'mindy', date: '2026-11-17', schema: 'mindy.doc/1', meta: { generatedBy: 'ask_mindy' } });
    expect(s.renders.every((x) => x.model.theme === 'mindy')).toBe(true);
  });

  it("theme 'briefing' is honored", async () => {
    const s = setup();
    await s.tool.execute({ doc_model: model(), theme: 'briefing' });
    expect(s.docs()[0].doc_model.theme).toBe('briefing');
  });

  it('label, don\'t refuse: an uncited fact is saved on the FIRST call, labeled Unverified (Ask Mindy runs one tool round per turn)', async () => {
    const s = setup();
    const bad = model({ sections: [{ id: 'a', heading: 'Summary', blocks: [
      { type: 'paragraph', id: 'p1', text: 'VA obligated $412.5M for janitorial services.', claim: 'fact', cites: ['s1'] },
      { type: 'paragraph', id: 'p2', text: 'Most buyers prefer local firms.', claim: 'fact' },
      { type: 'paragraph', id: 'p3', text: 'Proposals are due December 4.', claim: 'fact', critical: true },
    ] }] });
    const r = await s.tool.execute({ doc_model: bad });
    expect(r).toMatchObject({ ok: true, unverified_count: 1, omitted_count: 1 });
    const blocks = s.docs()[0].doc_model.sections[0].blocks;
    expect(blocks.map((b: R) => [b.id, b.claim])).toEqual([['p1', 'fact'], ['p2', 'unverified']]); // critical p3 omitted
    expect(String(r.note)).toMatch(/Unverified — no source/);
    expect(String(r.note)).toMatch(/left out/);
  });

  it('repeated method boilerplate is reported, never a reason to refuse', async () => {
    const s = setup();
    const boiler = 'The figures are drawn from the cited records and are reported as recorded without adjustment.';
    const m = model({ sections: [
      { id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'r1', text: `Track these offices. ${boiler}`, claim: 'recommendation' }] },
      { id: 'b', heading: 'B', blocks: [{ type: 'paragraph', id: 'r2', text: `Call early. ${boiler}`, claim: 'recommendation' }] },
    ] });
    expect(await s.tool.execute({ doc_model: m })).toMatchObject({ ok: true, repeated_sentences: 1 });
  });

  describe('source kinds (live failure 2026-11-17: guessed kinds were refused)', () => {
    it.each([
      ['uploaded_file', 'upload'], ['document', 'upload'], ['File', 'upload'],
      ['federal_data', 'usaspending'], ['FPDS', 'usaspending'], ['usaspending.gov', 'usaspending'],
      ['sam', 'sam_notice'], ['SAM.gov', 'sam_notice'], ['vault', 'vault'],
    ])('a guessed kind "%s" is normalized to "%s" and the document is saved', async (guess, expected) => {
      const s = setup();
      const r = await s.tool.execute({ doc_model: model({ sources: [{ id: 's1', kind: guess, label: 'Source', url: 'https://www.usaspending.gov/search' }] }) });
      expect(r).toMatchObject({ ok: true });
      expect(s.docs()[0].doc_model.sources[0].kind).toBe(expected);
    });

    it('an unknown kind is refused with the exact allowed values; nothing saved', async () => {
      const s = setup();
      const r = await s.tool.execute({ doc_model: model({ sources: [{ id: 's1', kind: 'press_release', label: 'Source' }] }) });
      expect(r).toMatchObject({ ok: false, error: 'invalid_document' });
      expect(JSON.stringify(r.issues)).toMatch(/unknown source kind \\"press_release\\"; allowed values: sam_notice, usaspending, upload, vault, tool, web, other/);
      expect((r.allowed as R).source_kind).toEqual(['sam_notice', 'usaspending', 'upload', 'vault', 'tool', 'web', 'other']);
      expect(s.docs()).toEqual([]);
    });
  });

  it('diagnostics: units before/after the repair and omissions BY REASON (no content)', async () => {
    const s = setup();
    const m = model({ sections: [{ id: 'a', heading: 'Summary', blocks: [
      { type: 'paragraph', id: 'p1', text: 'VA obligated $412.5M for janitorial services.', claim: 'fact', cites: ['s1'] },
      { type: 'paragraph', id: 'p2', text: 'We assume strong past performance with the VA.', claim: 'assumption', origin: 'x' },
      { type: 'paragraph', id: 'p3', text: 'Proposals are due December 4.', claim: 'fact', critical: true },
      { type: 'paragraph', id: 'p4', text: 'Most buyers prefer local firms.', claim: 'fact' },
    ] }] });
    const r = await s.tool.execute({ doc_model: m });
    expect(r).toMatchObject({ ok: true, diagnostics: { units_in: 4, units_out: 2, unverified: 1, omitted_by_reason: { never_an_assumption: 1, critical_without_source: 1 }, uncited_sources: [] } });
    expect(JSON.stringify(r.diagnostics)).not.toMatch(/past performance|December|local firms/);
  });

  it('the description tells the model to include the uploaded company material, cited to the upload, never as assumptions', () => {
    const d = CREATE_DOCUMENT_TOOL_DEF.function.description;
    expect(d).toMatch(/INCLUDING the user's uploaded company material/);
    expect(d).toMatch(/kind: 'upload', recordId: <the upload's document_id>/);
    expect(d).toMatch(/never label it an assumption and never leave it out/);
    expect(d).toMatch(/ONLY when the uploaded text states them, as facts citing the upload/);
  });

  it('the tool schema states every allowed value, exactly as the validator accepts them', () => {
    const dm = (CREATE_DOCUMENT_TOOL_DEF.function.parameters.properties.doc_model) as R;
    expect(dm.properties.sources.items.properties.kind.enum).toEqual([...SOURCE_KIND_VALUES]);
    const block = dm.properties.sections.items.properties.blocks.items.properties;
    expect(block.type.enum).toEqual([...BLOCK_TYPE_VALUES]);
    expect(block.claim.enum).toEqual([...CLAIM_VALUES]);
    expect(block.tone.enum).toEqual(['note', 'warning', 'key_finding']);
    expect(block.kind.enum).toEqual(['bar', 'line', 'pie']);
    expect(block.items.items.properties.claim.enum).toEqual([...CLAIM_VALUES]);
    expect(CREATE_DOCUMENT_TOOL_DEF.function.description).toMatch(/CALL THIS whenever the user asks to create, make, write up, export, download or save a document, report, PDF, Word file, capability statement/);
  });

  it('revision: an earlier ASSUMPTION re-emitted as a fact is refused; nothing saved', async () => {
    const parentModel = model({ sections: [{ id: 'a', heading: 'Summary', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Assume the program has 250 users across 12 sites.', claim: 'assumption', origin: 'Planning figure, not verified.' },
    ] }] });
    const P = '00000000-0000-4000-8000-00000000aaaa';
    const s = setup({ rows: [{ id: P, user_email: ME, doc_class: 'generated', archived_at: null, original_filename: 'Brief.docx', mime_type: DOCX_MIME, version: 1, parent_id: null, doc_model: parentModel }] });
    const hardened = model({ sections: [{ id: 'a', heading: 'Summary', blocks: [
      { type: 'paragraph', id: 'p1', text: 'The program has 250 users across 12 sites.', claim: 'fact', cites: ['s1'] },
    ] }] });
    const r = await s.tool.execute({ doc_model: hardened, revises_document_id: P });
    expect(r).toMatchObject({ ok: false, error: 'assumption_hardened', where: ['p1'] });
    expect(s.docs()).toHaveLength(1);
    expect(s.renders).toEqual([]);
  });

  it('revision: a NEW version per format (parent = previous Word / previous PDF); the previous rows are untouched', async () => {
    const P_DOCX = '00000000-0000-4000-8000-0000000000d1';
    const P_PDF = '00000000-0000-4000-8000-0000000000d2';
    const prev = { user_email: ME, doc_class: 'generated', archived_at: null, version: 1, parent_id: null, doc_model: model() };
    const s = setup({ rows: [
      { ...prev, id: P_DOCX, original_filename: 'Janitorial-Market-Brief.docx', mime_type: DOCX_MIME },
      { ...prev, id: P_PDF, original_filename: 'Janitorial-Market-Brief.pdf', mime_type: 'application/pdf' },
    ] });
    const before = JSON.stringify(s.docs());
    const r = await s.tool.execute({ doc_model: model({ title: 'Janitorial Market Brief' }), revises_document_id: P_PDF });
    expect(r).toMatchObject({ ok: true, version: 2 });
    const added = s.docs().slice(2);
    expect(added.map((d) => [d.mime_type, d.parent_id, d.version])).toEqual([[DOCX_MIME, P_DOCX, 2], ['application/pdf', P_PDF, 2]]);
    expect(JSON.stringify(s.docs().slice(0, 2))).toBe(before);
  });

  it("another account's document cannot be revised", async () => {
    const OTHER = '00000000-0000-4000-8000-0000000000ee';
    const s = setup({ rows: [{ id: OTHER, user_email: 'other@example.com', doc_class: 'generated', archived_at: null, original_filename: 'X.docx', mime_type: DOCX_MIME, version: 1, parent_id: null, doc_model: model() }] });
    expect(await s.tool.execute({ doc_model: model(), revises_document_id: OTHER })).toMatchObject({ ok: false, error: 'not_found' });
    expect(s.docs()).toHaveLength(1);
  });

  it('an unconfirmed workspace saves nothing (workspace_unavailable)', async () => {
    const s = setup({ scope: { kind: 'unavailable', email: ME } });
    expect(await s.tool.execute({ doc_model: model() })).toMatchObject({ ok: false, error: 'workspace_unavailable' });
    expect(s.docs()).toEqual([]);
  });

  it('a coach working as a client saves into the CLIENT Vault', async () => {
    const s = setup({ scope: { kind: 'client', email: ME, workspaceId: 'ws-1', vaultEmail: 'client@corp.com' } });
    const r = await s.tool.execute({ doc_model: model() });
    expect(r).toMatchObject({ ok: true, workspace: 'client' });
    expect(s.docs().every((d) => d.user_email === 'client@corp.com')).toBe(true);
  });

  it('refuses test-fixture / example-domain content and CUI or classified markings; nothing saved', async () => {
    const s = setup();
    expect(await s.tool.execute({ doc_model: model({ sources: [{ id: 's1', kind: 'web', label: 'x', url: 'https://example.com/a' }] }) })).toMatchObject({ ok: false, error: 'fixture_content' });
    const cui = model({ title: 'CUI', sections: [{ id: 'a', heading: 'CUI', blocks: [{ type: 'paragraph', id: 'p1', text: 'CUI', claim: 'fact', cites: ['s1'] }, { type: 'paragraph', id: 'p2', text: 'CONTROLLED UNCLASSIFIED INFORMATION', claim: 'fact', cites: ['s1'] }] }] });
    const r = await s.tool.execute({ doc_model: cui });
    expect(r).toMatchObject({ ok: false, error: 'prohibited_marking' });
    expect(s.docs()).toEqual([]);
  });

  describe('CUI/classified refusal sees EVERY rendered string (A4)', () => {
    const BANNER = 'CUI//SP-PROCURE';
    const withTable = (cell: string, label: string) => ({ type: 'table', id: 't1', claim: 'fact', cites: ['s1'], columns: [{ key: 'a', label }, { key: 'v', label: 'Value', format: 'usd' }], rows: [{ a: cell, v: 5_000_000 }] });
    const withChart = (series: string, x: string) => ({ type: 'chart', id: 'c1', kind: 'bar', claim: 'fact', cites: ['s1'], series: [{ name: series, points: [{ x, y: 3 }] }] });
    const cases: Array<[string, R]> = [
      ['paragraph', model({ sections: [{ id: 'a', heading: 'Summary', blocks: [{ type: 'paragraph', id: 'p1', text: BANNER, claim: 'fact', cites: ['s1'] }] }] })],
      ['table cell', model({ sections: [{ id: 'a', heading: 'Summary', blocks: [withTable(BANNER, 'Agency')] }] })],
      ['column label', model({ sections: [{ id: 'a', heading: 'Summary', blocks: [withTable('VA', BANNER)] }] })],
      ['chart series name', model({ sections: [{ id: 'a', heading: 'Summary', blocks: [withChart(BANNER, 'VA')] }] })],
      ['chart point label', model({ sections: [{ id: 'a', heading: 'Summary', blocks: [withChart('Obligations', BANNER)] }] })],
      ['source label', model({ sources: [{ id: 's1', kind: 'upload', label: BANNER }] })],
      ['source record id', model({ sources: [{ id: 's1', kind: 'tool', label: 'Query', recordId: BANNER }] })],
      ['cover attention line', model({ meta: { attention: BANNER } })],
    ];
    it.each(cases)('a banner in a %s is refused; nothing rendered or saved', async (_where, m) => {
      const s = setup();
      expect(await s.tool.execute({ doc_model: m })).toMatchObject({ ok: false, error: 'prohibited_marking' });
      expect(s.renders).toEqual([]);
      expect(s.docs()).toEqual([]);
      expect(s.storage.blobs).toEqual([]);
    });

    it('ordinary tables, charts and sources are not refused', async () => {
      const s = setup();
      const m = model({ sections: [{ id: 'a', heading: 'Summary', blocks: [withTable('VA', 'Agency'), withChart('Obligations', 'VA')] }] });
      expect(await s.tool.execute({ doc_model: m })).toMatchObject({ ok: true });
    });
  });

  it('PDF unavailable: the Word file is saved, the PDF is reported unavailable, and no HTML is saved as a PDF', async () => {
    const s = setup({ pdfDegraded: true });
    const r = await s.tool.execute({ doc_model: model() });
    expect(r).toMatchObject({ ok: true });
    expect((r.files as R[]).map((f) => f.format)).toEqual(['docx']);
    expect(String(r.pdf_note)).toMatch(/PDF could not be produced/);
    expect(s.docs()).toHaveLength(1);
    expect(s.docs()[0].mime_type).toBe(DOCX_MIME);
  });

  it('non-billable and classified: never offered in the billed card chat; an explicit owner-scoped write; refused without a workspace', () => {
    expect(CARD_CHAT_TOOLS.has(CREATE_DOCUMENT)).toBe(false);
    expect(chatToolPolicy(CREATE_DOCUMENT, true).decision).toBe('allowed_write');
    expect(VAULT_GROUNDED_TOOLS.has(CREATE_DOCUMENT)).toBe(true);
  });
});
