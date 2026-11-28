/**
 * create_document — DocModel → PDF + Word, saved to the acting scope's Vault as generated rows.
 * Fake db/storage/renderer (no network). Proves: per-caller flag (off / allowlist), default theme,
 * retry-then-label, boilerplate retry, assumptions never harden on revision, revisions are new
 * versions (never overwrite), workspace isolation, fixture and CUI refusal, honest PDF failure,
 * and that the tool is non-billable (never offered in the billed card chat).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeGenerateDocumentTool, CREATE_DOCUMENT, CREATE_DOCUMENT_TOOL_DEF, parseCreateDocumentDeliverables } from './generate-document-tool';
import { SOURCE_KIND_VALUES, BLOCK_TYPE_VALUES, CLAIM_VALUES } from '@/lib/documents/validate';
import { CARD_CHAT_TOOLS } from './card-chat';
import { chatToolPolicy } from './chat-tool-policy';
import { VAULT_GROUNDED_TOOLS } from './chat-tool-executor';
import { requestedDocSections } from './requested-doc-sections';

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

function setup(opts: {
  scope?: R;
  rows?: R[];
  pdfDegraded?: boolean;
  federalMarketProfile?: boolean;
  defenseBuyersAppear?: boolean;
  requestedSections?: ReturnType<typeof requestedDocSections>;
  provenance?: Array<{ retrievedAt: string; asOf?: string | null; url?: string | null; recordIds?: string[] }>;
  retryForHeading?: boolean;
} = {}) {
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
    ...(opts.requestedSections ? { requestedSections: opts.requestedSections } : {}),
    ...(opts.provenance ? { provenance: () => opts.provenance! } : {}),
    ...(opts.retryForHeading ? { retryForHeading: true } : {}),
    ...(opts.federalMarketProfile
      ? {
        federalMarketProfile: true,
        fmpWriteupContext: { defenseBuyersAppear: opts.defenseBuyersAppear ?? true },
      }
      : {}),
    render: (async (m: R, format: string) => {
      renders.push({ format, model: m });
      if (format === 'pdf' && opts.pdfDegraded) return { ok: true, format: 'html', bytes: Buffer.from('<html>'), mime: 'text/html', filename: 'x.html', degraded: { requested: 'pdf', reason: 'no browser' } };
      return { ok: true, format, bytes: Buffer.from(`%${format}`), mime: format, filename: `Janitorial-Market-Brief.${format}`, degraded: null };
    }) as never,
  });
  const docs = () => tables.user_boilerplate_docs;
  return { tool, tables, storage, renders, docs };
}

function fmpDocModel(): R {
  return {
    title: 'RBA Federal Market Profile',
    sources: [{ id: 's1', kind: 'usaspending', label: 'USAspending' }],
    sections: [
      {
        id: 'sec-path',
        heading: 'Six pathways, in priority order',
        blocks: [{ type: 'paragraph', id: 'p1', text: 'Vehicles then sources sought. Market $470M.', claim: 'fact', cites: ['s1'] }],
      },
      {
        id: 'sec-pae',
        heading: 'Who owns defense construction now: the PAE shift',
        blocks: [{ type: 'paragraph', id: 'p2', text: 'PAE oversight.', claim: 'fact', cites: ['s1'] }],
      },
      {
        id: 'sec-pain',
        heading: 'What buyers are under pressure to fix',
        blocks: [{ type: 'paragraph', id: 'p3', text: 'Deferred maintenance.', claim: 'fact', cites: ['s1'] }],
      },
      {
        id: 'sec-who',
        heading: 'Who to talk to and what to say',
        blocks: [{
          type: 'table',
          id: 't1',
          columns: [{ key: 'contact', label: 'Contact' }, { key: 'question', label: 'Question to ask' }],
          rows: [{ contact: 'Helson Roman', question: 'Ask about MATOC seats.' }],
        }],
      },
      {
        id: 'sec-ready',
        heading: 'Readiness checklist',
        blocks: [{
          type: 'bullets',
          id: 'b1',
          ordered: false,
          items: [{ text: 'Update DSBS keywords for bridge work.', claim: 'recommendation' }],
        }],
      },
    ],
  };
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
    expect(String(r.note)).toMatch(/Unverified: no source/);
    expect(String(r.note)).toMatch(/left out/);
  });

  it('structure repair: duplicate ids + empty table columns still save on the first call (live 2026-11-19)', async () => {
    const s = setup();
    const messy = model({
      sections: [
        { id: 'sec', heading: 'Buyers', blocks: [{ type: 'paragraph', id: 'p', text: 'NAVFAC Hawaii leads HI building construction.', claim: 'fact', cites: ['s1'] }] },
        {
          id: 'sec',
          heading: 'Awards',
          blocks: [{
            type: 'table',
            id: 'p',
            claim: 'fact',
            cites: ['s1'],
            columns: [],
            rows: [{ office: 'Navfacsyscom Hawaii', dollars: 1_190_000_000 }],
          }],
        },
      ],
    });
    const r = await s.tool.execute({ doc_model: messy });
    expect(r).toMatchObject({ ok: true, saved_to: 'vault' });
    // Table → Word/PDF plus Excel/CSV (modelHasTables).
    expect((r.files as R[]).map((f) => f.format).sort()).toEqual(['csv', 'docx', 'pdf', 'xlsx']);
    const saved = s.docs().find((d) => d.mime_type === DOCX_MIME)!.doc_model;
    expect(saved.sections.map((sec: R) => sec.id)).toEqual(['sec', 'sec-2']);
    expect(saved.sections[1].blocks[0].columns.length).toBeGreaterThan(0);
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
    expect(CREATE_DOCUMENT_TOOL_DEF.function.description).toMatch(/CALL THIS whenever the user asks to create, make, write up, export, download or save a document, report, PDF, Word file, Excel, spreadsheet, CSV, capability statement/);
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

  it('W4: table blocks also save Excel and CSV; include_spreadsheet:false keeps Word/PDF only', async () => {
    const withTable = model({
      sections: [{
        id: 'a',
        heading: 'Buyers',
        blocks: [{
          type: 'table',
          id: 't1',
          claim: 'fact',
          cites: ['s1'],
          columns: [{ key: 'agency', label: 'Agency' }, { key: 'n', label: 'Count', format: 'int' }],
          rows: [{ agency: 'VA', n: 12 }],
        }],
      }],
    });
    const s = setup();
    const r = await s.tool.execute({ doc_model: withTable });
    expect(r).toMatchObject({ ok: true });
    expect((r.files as R[]).map((f) => f.format)).toEqual(['docx', 'pdf', 'xlsx', 'csv']);
    expect(s.renders.map((x) => x.format)).toEqual(expect.arrayContaining(['docx', 'pdf', 'xlsx', 'csv']));

    const s2 = setup();
    const r2 = await s2.tool.execute({ doc_model: withTable, include_spreadsheet: false });
    expect((r2.files as R[]).map((f) => f.format)).toEqual(['docx', 'pdf']);
  });

  it('W4: revising a Word-only parent with a table model keeps result version from the Word save', async () => {
    const P = '00000000-0000-4000-8000-00000000bbbb';
    const parentModel = model();
    const s = setup({
      rows: [{
        id: P, user_email: ME, doc_class: 'generated', archived_at: null,
        original_filename: 'Brief.docx', mime_type: DOCX_MIME, version: 1, parent_id: null, doc_model: parentModel,
      }],
    });
    const withTable = model({
      sections: [{
        id: 'a', heading: 'Buyers', blocks: [{
          type: 'table', id: 't1', claim: 'fact', cites: ['s1'],
          columns: [{ key: 'agency', label: 'Agency' }], rows: [{ agency: 'VA' }],
        }],
      }],
    });
    const r = await s.tool.execute({ doc_model: withTable, revises_document_id: P });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((r.files as R[]).map((f) => f.format)).toEqual(['docx', 'pdf', 'xlsx', 'csv']);
  });

  it('non-billable and classified: never offered in the billed card chat; an explicit owner-scoped write; refused without a workspace', () => {
    expect(CARD_CHAT_TOOLS.has(CREATE_DOCUMENT)).toBe(false);
    expect(chatToolPolicy(CREATE_DOCUMENT, true).decision).toBe('allowed_write');
    expect(VAULT_GROUNDED_TOOLS.has(CREATE_DOCUMENT)).toBe(true);
  });
});

describe('create_document FMP write-up gate', () => {
  it('FMP flag on + incomplete profile → fmp_writeup_invalid, nothing saved', async () => {
    const s = setup({ federalMarketProfile: true, defenseBuyersAppear: true });
    const r = await s.tool.execute({ doc_model: model() });
    expect(r).toMatchObject({ ok: false, error: 'fmp_writeup_invalid' });
    expect(s.docs()).toEqual([]);
    expect(s.renders).toEqual([]);
  });

  it('FMP flag on + valid pathway profile → saves', async () => {
    const s = setup({ federalMarketProfile: true, defenseBuyersAppear: true });
    const r = await s.tool.execute({ doc_model: fmpDocModel() });
    expect(r).toMatchObject({ ok: true, saved_to: 'vault' });
    expect(s.docs().length).toBeGreaterThan(0);
  });

  it('non-FMP create_document is unchanged (short brief still saves)', async () => {
    const s = setup();
    const r = await s.tool.execute({ doc_model: model() });
    expect(r).toMatchObject({ ok: true, saved_to: 'vault' });
  });
});

describe('parseCreateDocumentDeliverables', () => {
  it('extracts files and pdf_note from a successful save', () => {
    const parsed = parseCreateDocumentDeliverables(JSON.stringify({
      ok: true,
      title: 'Strategy',
      pdf_note: 'The PDF could not be produced right now; the Word file was saved.',
      files: [
        { format: 'docx', document_id: '00000000-0000-4000-8000-000000000001', file_name: 'Strategy.docx', version: 1 },
        { format: 'pdf', document_id: '00000000-0000-4000-8000-000000000002', file_name: 'Strategy.pdf', version: 1 },
      ],
    }));
    expect(parsed?.title).toBe('Strategy');
    expect(parsed?.pdf_note).toMatch(/PDF could not be produced/);
    expect(parsed?.files.map((f) => f.format)).toEqual(['docx', 'pdf']);
  });

  it('returns null for refused or empty results', () => {
    expect(parseCreateDocumentDeliverables(JSON.stringify({ ok: false, error: 'prohibited_marking' }))).toBeNull();
    expect(parseCreateDocumentDeliverables(JSON.stringify({ ok: true, files: [] }))).toBeNull();
    expect(parseCreateDocumentDeliverables('not-json')).toBeNull();
  });
});

describe('create_document: the sections the customer asked for are in the saved DocModel (Claude Local 2026-11-22)', () => {
  const ASK = 'Turn this into a PDF report with an executive summary, risks, actions and sources';
  // A planner doc_model that left the requested sections out (the production defect): body only.
  const bodyOnly = () => model({
    sources: [
      { id: 's1', kind: 'usaspending', label: 'USAspending award data', url: 'https://www.usaspending.gov/award/CONT_AWD_36C24825C0020' },
      { id: 's2', kind: 'sam_notice', label: 'SAM.gov notice', url: 'https://sam.gov/opp/abc/view' },
    ],
    sections: [
      { id: 'sec-demand', heading: 'Where demand is', blocks: [
        { type: 'paragraph', id: 'p1', text: 'VA obligated $412.5M for janitorial services in FY2025.', claim: 'fact', cites: ['s1'] },
        { type: 'paragraph', id: 'p2', text: 'The current contract expires in March 2027.', claim: 'fact', cites: ['s1'] },
      ] },
      { id: 'sec-fit', heading: 'How you fit', blocks: [
        { type: 'paragraph', id: 'p3', text: 'An open notice at the Augusta VA asks for the same services.', claim: 'fact', cites: ['s2'] },
        { type: 'paragraph', id: 'p4', text: 'Staffing costs at the Augusta site could rise faster than planned.', claim: 'assumption', origin: 'Planning premise for pricing; not confirmed with the buyer.' },
        { type: 'paragraph', id: 'p5', text: 'Request a capability briefing with the Augusta VA contracting office this month.', claim: 'recommendation', cites: ['s2'] },
      ] },
    ],
  });

  it('a request for executive summary, risks, actions and sources produces them in the saved DocModel, with sources', async () => {
    const s = setup({ requestedSections: requestedDocSections(ASK) });
    const r = await s.tool.execute({ doc_model: bodyOnly() });
    expect(r).toMatchObject({ ok: true, requested_sections: { requested: ['executive_summary', 'risks', 'actions', 'sources'], added: ['executive_summary', 'risks', 'actions'], missing: [] } });
    const saved = s.docs()[0].doc_model;
    const headings = saved.sections.map((x: R) => x.heading);
    expect(headings[0]).toBe('Executive summary');
    // level 1: the renderer's contents page counts level-1 sections
    for (const h of ['Executive summary', 'Risks', 'Recommended actions']) expect(saved.sections.find((x: R) => x.heading === h).level).toBe(1);
    expect(headings).toContain('Risks');
    expect(headings).toContain('Recommended actions');
    // every format renders the completed model
    for (const x of s.renders) expect(x.model.sections.map((y: R) => y.heading)).toEqual(headings);
    const items = (h: string) => saved.sections.find((x: R) => x.heading === h).blocks[0].items as R[];
    // built from the document's own statements, labels and cites copied: no new fact, no new source
    const bodyTexts = new Set(bodyOnly().sections.flatMap((x: R) => x.blocks.map((b: R) => b.text)));
    for (const h of ['Executive summary', 'Risks', 'Recommended actions']) for (const it of items(h)) expect(bodyTexts.has(it.text)).toBe(true);
    expect(items('Executive summary')[0]).toMatchObject({ text: 'VA obligated $412.5M for janitorial services in FY2025.', claim: 'fact', cites: ['s1'] });
    expect(items('Recommended actions')).toEqual([{ text: 'Request a capability briefing with the Augusta VA contracting office this month.', claim: 'recommendation', cites: ['s2'] }]);
    expect(items('Risks')[0]).toMatchObject({ claim: 'assumption', origin: expect.stringContaining('not confirmed') });
    expect(saved.sources.map((x: R) => x.id)).toEqual(['s1', 's2']);
    // Sources: every declared source is cited, so the rendered Sources list carries both
    const cited = new Set(saved.sections.flatMap((x: R) => x.blocks.flatMap((b: R) => [...(b.cites ?? []), ...((b.items ?? []) as R[]).flatMap((i) => i.cites ?? [])])));
    expect([...cited].sort()).toEqual(['s1', 's2']);
    expect(String(r.note)).not.toMatch(/NOT in the saved file/);
  });

  it('a doc_model that already carries the requested sections is saved unchanged', async () => {
    const s = setup({ requestedSections: requestedDocSections(ASK) });
    const full = bodyOnly();
    full.sections = [
      { id: 'x', heading: 'Executive summary', blocks: [{ type: 'paragraph', id: 'e', text: 'VA spends on janitorial services.', claim: 'fact', cites: ['s1'] }] },
      ...full.sections,
      { id: 'r', heading: 'Key risks', blocks: [{ type: 'paragraph', id: 'r1', text: 'Staffing costs could rise faster than planned.', claim: 'assumption', origin: 'Planning premise; not verified.' }] },
      { id: 'n', heading: 'Next steps', blocks: [{ type: 'paragraph', id: 'n1', text: 'Call the office.', claim: 'recommendation' }] },
    ];
    const r = await s.tool.execute({ doc_model: full });
    expect(r).toMatchObject({ ok: true, requested_sections: { added: [], missing: [] } });
    expect(s.docs()[0].doc_model.sections.map((x: R) => x.heading)).toEqual(['Executive summary', 'Where demand is', 'How you fit', 'Key risks', 'Next steps']);
  });

  it('nothing to build from: the file is saved without padding and the answer is told to say so plainly', async () => {
    const s = setup({ requestedSections: requestedDocSections('Make a Word doc with risks, action items and citations') });
    const r = await s.tool.execute({ doc_model: model({ sources: [], sections: [{ id: 'a', heading: 'Overview', blocks: [{ type: 'paragraph', id: 'p', text: 'The firm cleans federal offices.', claim: 'recommendation' }] }] }) });
    expect(r).toMatchObject({ ok: true, requested_sections: { added: ['actions'], missing: ['risks', 'sources'] } });
    expect(s.docs()[0].doc_model.sections.map((x: R) => x.heading)).toEqual(['Overview', 'Recommended actions']);
    expect(String(r.note)).toMatch(/asked for Risks, Sources in the document, but they are NOT in the saved file/);
  });

  it('no sections named: the tool is unchanged (no requested_sections field, model untouched)', async () => {
    const s = setup({ requestedSections: requestedDocSections('Make this a PDF') });
    const r = await s.tool.execute({ doc_model: bodyOnly() });
    expect(r).not.toHaveProperty('requested_sections');
    expect(s.docs()[0].doc_model.sections.map((x: R) => x.heading)).toEqual(['Where demand is', 'How you fit']);
  });
});

describe('create_document: source provenance from tool results (read dates, links, data-date subtitle)', () => {
  it('fills DocSource read date and link from a matching tool result; no "Data as of" subtitle (Eric, 2026-11-27)', async () => {
    const s = setup({ provenance: [{ retrievedAt: '2026-11-22T15:04:00Z', asOf: '2026-11-20', url: 'https://www.usaspending.gov/award/CONT_AWD_W9124D26D0005', recordIds: ['W9124D26D0005'] }] });
    const r = await s.tool.execute({ doc_model: model({ sources: [{ id: 's1', kind: 'usaspending', label: 'USAspending award', recordId: 'W9124D26D0005' }] }) });
    expect(r).toMatchObject({ ok: true, source_provenance: { filledRetrievedAt: 1, filledUrl: 1, unmatched: 0, subtitleSet: false } });
    const saved = s.docs()[0].doc_model;
    expect(saved.sources[0]).toMatchObject({ retrievedAt: '2026-11-22', url: 'https://www.usaspending.gov/award/CONT_AWD_W9124D26D0005', recordId: 'W9124D26D0005' });
    expect(saved.subtitle).toBeUndefined();
    // statements untouched
    expect(saved.sections[0].blocks[0].text).toBe('VA obligated $412.5M for janitorial services.');
  });

  it('no matching tool result: the source is saved without the model\'s unverified link or date (never shown as verified)', async () => {
    const s = setup({ provenance: [{ retrievedAt: '2026-11-22T15:04:00Z', url: 'https://sam.gov/opp/zzz/view', recordIds: ['zzz'] }] });
    const r = await s.tool.execute({ doc_model: model({ sources: [{ id: 's1', kind: 'usaspending', label: 'USAspending award data', url: 'https://www.usaspending.gov/search', retrievedAt: '2025-06-01' }] }) });
    expect(r).toMatchObject({ ok: true, source_provenance: { unmatched: 1, filledRetrievedAt: 0, removedUnverified: 2, subtitleSet: false } });
    expect(s.docs()[0].doc_model.sources[0]).toEqual({ id: 's1', kind: 'usaspending', label: 'USAspending award data' });
    // what the customer sees: the rendered Word/PDF model carries no unverified date
    expect(s.renders.every((x) => x.model.sources[0].retrievedAt === undefined)).toBe(true);
  });
});

describe('a market or company report carries a section titled exactly "How They Buy Now" (production retest 2026-11-27)', () => {
  const sec = (id: string, heading: string) => ({ id, heading, blocks: [{ type: 'paragraph', id: `p-${id}`, text: `VA obligated $412.5M for janitorial services (${heading}).`, claim: 'fact', cites: ['s1'] }] });
  const reportWithout = () => model({ title: 'Acme Clean market report', sections: [sec('a', 'Summary'), sec('b', 'Where the money is moving'), sec('c', 'Pathways'), sec('d', 'Action plan')] });
  const reportWith = () => model({ title: 'Acme Clean market report', sections: [sec('a', 'Summary'), sec('h', 'How They Buy Now'), sec('b', 'Where the money is moving'), sec('c', 'Pathways'), sec('d', 'Action plan')] });

  beforeEach(() => { vi.stubEnv('VAULT_GENERATED_FILES', 'true'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('research mode: the first report without the heading is refused with the fix and nothing is saved; the corrected one is saved with it', async () => {
    const { tool, docs, renders } = setup({ retryForHeading: true });
    const r1 = await tool.execute({ doc_model: reportWithout() });
    expect(r1).toMatchObject({ ok: false, error: 'missing_how_they_buy_now' });
    expect(String(r1.note)).toContain('titled exactly "How They Buy Now" right after the Summary');
    expect(docs()).toHaveLength(0);
    const r2 = await tool.execute({ doc_model: reportWith() });
    expect(r2.ok).toBe(true);
    expect(r2).not.toHaveProperty('missing_section');
    const headings = (renders[0].model.sections as Array<{ heading: string }>).map((x) => x.heading);
    expect(headings.slice(0, 2)).toEqual(['Summary', 'How They Buy Now']);
  });

  it('a report is never lost: a second attempt still without the heading is saved, with a warning', async () => {
    const { tool, docs } = setup({ retryForHeading: true });
    await tool.execute({ doc_model: reportWithout() });
    const r2 = await tool.execute({ doc_model: reportWithout() });
    expect(r2).toMatchObject({ ok: true, missing_section: 'How They Buy Now' });
    expect(String(r2.note)).toMatch(/no section titled "How They Buy Now"/);
    expect(docs().length).toBeGreaterThan(0);
  });

  it('standard path (one tool round): saved with the warning, never refused', async () => {
    const { tool } = setup();
    const r = await tool.execute({ doc_model: reportWithout() });
    expect(r).toMatchObject({ ok: true, missing_section: 'How They Buy Now' });
  });

  it('a document that is not a How They Buy Now report is untouched (one marker is not enough)', async () => {
    const { tool } = setup({ retryForHeading: true });
    const r = await tool.execute({ doc_model: model({ sections: [sec('a', 'Summary'), sec('d', 'Action plan')] }) });
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('missing_section');
  });
});

describe("a company's own file-sourced claim in a document FOR that company (Eric, 2026-11-27, claims-by-audience)", () => {
  beforeEach(() => { vi.stubEnv('VAULT_GENERATED_FILES', 'true'); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it('a fact citing the upload is kept verbatim (same word, same figure) with no "Unverified" label', async () => {
    const { tool, renders } = setup();
    const CLAIM = 'Northwind Federal Partners has funded $35 billion+ in federal programs.';
    const r = await tool.execute({ doc_model: model({
      title: 'Northwind Federal Partners market report',
      sources: [{ id: 'u1', kind: 'upload', label: 'Northwind Capability Statement.pdf' }],
      sections: [{ id: 'a', heading: 'Where Northwind stands', blocks: [{ type: 'paragraph', id: 'p1', text: CLAIM, claim: 'fact', cites: ['u1'] }] }],
    }) });
    expect(r).toMatchObject({ ok: true, unverified_count: 0, omitted_count: 0 });
    const saved = JSON.stringify(renders[0].model);
    expect(saved).toContain(CLAIM);
    expect(saved).not.toMatch(/Unverified/);
    expect(String(r.note)).not.toMatch(/NO block cites them/);
  });
});
