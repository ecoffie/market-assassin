/**
 * Ask Mindy tool `create_document` — render a DocModel to a client-ready PDF and an editable Word file
 * and save both privately to the Vault as doc_class='generated' rows (#2116), owned by the acting scope.
 *
 * Rules (Eric, 2026-11-17), enforced here, never trusted to the model:
 *   - GROUNDING: the engine validator (src/lib/documents/validate.ts) decides. RETRY THEN LABEL: the
 *     first attempt that fails grounding (or repeats method boilerplate across sections) is returned
 *     with the issues so the model fixes it once; the second attempt is repaired by demoteUncitedFacts
 *     (uncited facts → "Unverified — no source", decision-critical ones omitted) and saved only if it then
 *     validates. Structural errors are never "repaired" — they are refused.
 *   - ASSUMPTIONS NEVER HARDEN: a revision whose model re-emits a prior ASSUMPTION as a fact is refused
 *     (hardenedAssumptions against the parent's stored DocModel).
 *   - No test fixture or example-domain content (fixtureMarkers), no CUI or classified markings
 *     (the Vault upload detector), default theme 'mindy'.
 *   - SCOPE: the acting scope's Vault only. An unconfirmed workspace saves nothing (workspace_unavailable).
 *   - NEVER OVERWRITES: a revision is a NEW row per format (version + 1, parent_id). The previous version
 *     is untouched.
 *   - NON-BILLABLE: creating a document is not a new intelligence answer. This tool is offered only in
 *     the main Ask Mindy chat (never in card chat, which is the only billed surface) and carries no price.
 *
 * Offered only when VAULT_GENERATED_FILES is on for the verified caller ('true' or 'allowlist').
 */
import { DOC_SCHEMA, labeledUnits, type DocModel } from '@/lib/documents/model';
import { validateDocModel, demoteUncitedFacts, hardenedAssumptions, repeatedSentences, fixtureMarkers } from '@/lib/documents/validate';
import { renderDocument } from '@/lib/documents';
import { saveGeneratedDocument, type GeneratedDb } from '@/lib/vault/generated';
import type { VaultStorage, VaultUploadInput } from '@/lib/vault/upload';
import { detectProhibitedMarkings, markingRefusalMessage } from '@/lib/vault/marking-detect';
import { vaultEmailFor, WORKSPACE_UNCONFIRMED_NOTE, type ChatActingScope } from './chat-acting-scope';
import { vaultDocEnabledFor } from '@/lib/vault/flags';

export const CREATE_DOCUMENT = 'create_document';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const CREATE_DOCUMENT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: CREATE_DOCUMENT,
    description:
      "Create a client-ready document (a PDF and an editable Word file) from research in this conversation, saved privately to the user's Vault. Use it only when the user asks for a document, report or deliverable. Every block needs a claim label: 'fact' (must cite a source id from `sources`), 'assumption' (a planning premise, with an `origin` sentence if uncited), 'recommendation', 'unverified' or 'context' (only in an 'about' section, no numbers). Certifications, contract awards, past performance and eligibility can never be assumptions. To revise a document Mindy made earlier, pass its document_id as revises_document_id: a new version is saved and the old one is kept. If the result asks you to fix issues, fix them and call once more.",
    parameters: {
      type: 'object',
      properties: {
        doc_model: {
          type: 'object',
          description: "The document: { title, subtitle?, preparedFor?, sources: [{id,label,kind,url?,retrievedAt?,recordId?}], sections: [{id, heading, role?: 'about', blocks: [...]}] }. Blocks: paragraph {type,id,text,claim,cites?,origin?}, bullets {type,id,items:[{text,claim,cites?}]}, table {type,id,caption?,claim,cites?,columns:[{key,label,format?}],rows:[{...}]}, chart {type,id,kind:'bar'|'line'|'pie',caption?,claim,cites?,valueFormat?,series:[{name,points:[{x,y}]}]}, callout {type,id,tone:'note'|'warning'|'key_finding',text,claim,cites?}.",
        },
        revises_document_id: { type: 'string', description: 'The document_id of a document Mindy generated earlier, when this is a revision of it.' },
        theme: { type: 'string', enum: ['mindy', 'briefing'], description: "Visual style. Default 'mindy'." },
      },
      required: ['doc_model'],
      additionalProperties: false,
    },
  },
};

export interface GenerateDocumentDeps {
  db: GeneratedDb;
  storage: VaultStorage;
  scope: ChatActingScope;
  /** The VERIFIED session email (the actor). */
  callerEmail: string;
  request: VaultUploadInput['request'];
  chatSessionId: string | null;
  render?: typeof renderDocument;
  today?: () => string;
}

type Row = { id: string; original_filename: string; mime_type: string | null; version: number | null; parent_id: string | null; doc_model: unknown };

/** All readable text of a model (title, headings, every labeled unit, origins) — for marking checks and Vault search. */
export function docModelText(m: DocModel): string {
  const parts: string[] = [m.title, m.subtitle ?? '', m.preparedFor ?? ''];
  for (const s of m.sections) {
    parts.push(s.heading);
    for (const b of s.blocks) for (const u of labeledUnits(b)) { parts.push(u.text); if (u.origin) parts.push(u.origin); }
  }
  return parts.filter(Boolean).join('\n');
}

const baseName = (f: string) => f.replace(/\.(pdf|docx)$/i, '');

export function makeGenerateDocumentTool(deps: GenerateDocumentDeps) {
  const owner = vaultEmailFor(deps.scope);
  const workspaceNote = deps.scope.kind === 'client' ? { workspace: 'client' as const } : {};
  let attempts = 0; // retry-then-label is per turn: this closure lives for one turn

  async function loadParent(id: string): Promise<Row | null | 'error'> {
    const { data, error } = await deps.db.from('user_boilerplate_docs')
      .select('id, original_filename, mime_type, version, parent_id, doc_model')
      .eq('id', id).eq('user_email', owner).eq('doc_class', 'generated').is('archived_at', null).maybeSingle();
    if (error) return 'error';
    return (data as Row) ?? null;
  }

  /** The other-format file saved together with `row` (same name, version and parent). */
  async function loadPair(row: Row): Promise<Row | null> {
    let q = deps.db.from('user_boilerplate_docs')
      .select('id, original_filename, mime_type, version, parent_id, doc_model')
      .eq('user_email', owner).eq('doc_class', 'generated').is('archived_at', null).eq('version', row.version ?? 1);
    q = row.parent_id ? q.eq('parent_id', row.parent_id) : q.is('parent_id', null);
    const { data, error } = await q.limit(20);
    if (error || !Array.isArray(data)) return null;
    return (data as Row[]).find((r) => r.id !== row.id && r.mime_type !== row.mime_type && baseName(r.original_filename) === baseName(row.original_filename)) ?? null;
  }

  async function execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // The tool's OWN flag check (saveGeneratedDocument has none): not enabled for this verified caller
    // ('true' or allowlisted) behaves exactly like off — nothing is rendered, read or saved.
    if (!vaultDocEnabledFor('generate', deps.callerEmail)) return { ok: false, error: 'not_available', note: 'Creating documents is not available here.' };
    if (!owner) return { ok: false, error: 'workspace_unavailable', note: WORKSPACE_UNCONFIRMED_NOTE };
    attempts += 1;
    const raw = args?.doc_model;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_document', note: 'doc_model must be an object.' };

    // Server-owned fields: schema, date, theme default, provenance.
    const theme = args?.theme === 'briefing' ? 'briefing' : (raw as { theme?: unknown }).theme === 'briefing' ? 'briefing' : 'mindy';
    let model = {
      ...(raw as Record<string, unknown>),
      schema: DOC_SCHEMA,
      date: (deps.today ?? (() => new Date().toISOString().slice(0, 10)))(),
      theme,
      meta: { ...(((raw as { meta?: Record<string, unknown> }).meta) ?? {}), generatedBy: 'ask_mindy' },
    } as unknown as DocModel;

    const markers = fixtureMarkers(model);
    if (markers.length) return { ok: false, error: 'fixture_content', note: 'Example or test content cannot be saved as a document. Use the research from this conversation.' };

    // Retry then label.
    let v = validateDocModel(model);
    const repeats = v.ok ? repeatedSentences(model) : [];
    if ((!v.ok || repeats.length) && attempts === 1) {
      return {
        ok: false,
        error: v.ok ? 'repeated_boilerplate' : 'grounding_failed',
        issues: v.ok ? repeats.map((r) => `repeated in ${r.where.join(', ')}: "${r.sentence.slice(0, 80)}"`) : v.issues.slice(0, 25).map((i) => `${i.path}: ${i.message}`),
        note: v.ok
          ? 'State method text once, in the "about" section; keep qualifications next to their claims. Fix this and call create_document once more.'
          : 'Fix these issues (cite a source for each fact, label every block) and call create_document once more. On the next attempt, any fact still without a source will be labeled "Unverified — no source", and decision-critical ones omitted.',
      };
    }
    let unverified: string[] = [];
    let omitted: string[] = [];
    if (!v.ok) {
      const d = demoteUncitedFacts(model);
      model = d.model; unverified = d.unverified; omitted = d.omitted;
      v = validateDocModel(model);
      if (!v.ok) return { ok: false, error: 'invalid_document', issues: v.issues.slice(0, 25).map((i) => `${i.path}: ${i.message}`), note: 'The document could not be built. Nothing was saved.' };
    }

    const text = docModelText(model);
    const marking = detectProhibitedMarkings(text);
    if (marking.blocked && marking.kind) return { ok: false, error: 'prohibited_marking', note: markingRefusalMessage(marking.kind) };

    // Revision: the parent (and its other-format pair) must be this owner's generated document, and no
    // assumption may come back as a fact.
    let parentDocx: string | null = null;
    let parentPdf: string | null = null;
    const revId = typeof args?.revises_document_id === 'string' ? args.revises_document_id.trim() : '';
    if (revId) {
      if (!UUID_RE.test(revId)) return { ok: false, error: 'not_found', note: 'No generated document has that id. Nothing was saved.' };
      const parent = await loadParent(revId);
      if (parent === 'error') return { ok: false, error: 'documents_unavailable', note: 'Saved documents could not be read. Nothing was saved.' };
      if (!parent) return { ok: false, error: 'not_found', note: 'No generated document with that id in this workspace. Nothing was saved.' };
      if (parent.doc_model && typeof parent.doc_model === 'object') {
        const hardened = hardenedAssumptions(parent.doc_model as DocModel, model);
        if (hardened.length) {
          return { ok: false, error: 'assumption_hardened', where: hardened, note: 'A revision cannot turn an earlier assumption into a fact. Keep those statements labeled assumption (or cite them as facts with a real source in a new statement). Nothing was saved.' };
        }
      }
      const pair = await loadPair(parent);
      const isDocx = parent.mime_type === DOCX_MIME;
      parentDocx = isDocx ? parent.id : pair?.id ?? null;
      parentPdf = isDocx ? pair?.id ?? null : parent.id;
    }

    const render = deps.render ?? renderDocument;
    const files: Array<Record<string, unknown>> = [];
    let version: number | null = null;
    const save = async (format: 'docx' | 'pdf', bytes: Buffer, filename: string, parentId: string | null) => {
      const saved = await saveGeneratedDocument(
        { callerEmail: deps.callerEmail, request: deps.request, format, filename, bytes, docModel: model, text, parentId, chatSessionId: deps.chatSessionId },
        { db: deps.db, storage: deps.storage, resolveScope: async () => deps.scope },
      );
      if (!saved.ok) return saved;
      version = saved.version;
      const id = String(saved.document.id);
      files.push({ format, document_id: id, file_name: saved.document.original_filename, version: saved.version, download_path: `/api/app/vault/documents/download?id=${id}` });
      return saved;
    };

    const docx = await render(model, 'docx');
    if (!docx.ok || docx.degraded) return { ok: false, error: 'render_failed', note: 'The Word file could not be built. Nothing was saved.' };
    const savedDocx = await save('docx', docx.bytes, docx.filename, parentDocx);
    if (!savedDocx.ok) return { ok: false, error: savedDocx.code, note: savedDocx.message, ...workspaceNote };

    let pdfNote: string | null = null;
    const pdf = await render(model, 'pdf');
    if (pdf.ok && !pdf.degraded) {
      const savedPdf = await save('pdf', pdf.bytes, pdf.filename, parentPdf);
      if (!savedPdf.ok) pdfNote = `The PDF could not be saved (${savedPdf.code}); the Word file was saved.`;
    } else {
      // Never save printable HTML as a "PDF".
      pdfNote = 'The PDF could not be produced right now; the Word file was saved. Ask again later for the PDF.';
    }

    return {
      ok: true,
      ...workspaceNote,
      saved_to: 'vault',
      title: model.title,
      version,
      files,
      unverified_count: unverified.length,
      omitted_count: omitted.length,
      ...(pdfNote ? { pdf_note: pdfNote } : {}),
      note: 'Saved privately to the Vault (Documents → Generated). Tell the user the file names and that they can download them there; do not paste download links.'
        + (unverified.length ? ` ${unverified.length} statement(s) are labeled "Unverified — no source"; say so.` : '')
        + (omitted.length ? ` ${omitted.length} decision-critical statement(s) without a source were left out; say so.` : ''),
    };
  }

  return { execute };
}
