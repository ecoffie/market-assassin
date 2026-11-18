/**
 * Ask Mindy tool `create_document` — render a DocModel to a client-ready PDF and an editable Word file
 * and save both privately to the Vault as doc_class='generated' rows (#2116), owned by the acting scope.
 *
 * Rules (Eric, 2026-11-17), enforced here, never trusted to the model:
 *   - GROUNDING: the engine validator (src/lib/documents/validate.ts) decides. LABEL, DON'T REFUSE: Ask
 *     Mindy runs one tool round per turn, so an uncited or unsupported fact is repaired on the FIRST call
 *     by demoteUncitedFacts (→ "Unverified — no source"; decision-critical ones omitted) and saved.
 *     Structural errors and unknown values are refused with the exact allowed values. Common source-kind
 *     names are normalized first (uploaded_file → upload, fpds → usaspending, sam.gov → sam_notice).
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
import { validateDocModel, demoteUncitedFacts, hardenedAssumptions, repeatedSentences, fixtureMarkers, neverAnAssumption, citedObservationAsAssumption, BLOCK_TYPE_VALUES, CLAIM_VALUES, SOURCE_KIND_VALUES } from '@/lib/documents/validate';
import { renderDocument } from '@/lib/documents';
import { saveGeneratedDocument, type GeneratedDb } from '@/lib/vault/generated';
import type { VaultStorage, VaultUploadInput } from '@/lib/vault/upload';
import { detectProhibitedMarkings, markingRefusalMessage } from '@/lib/vault/marking-detect';
import { vaultEmailFor, WORKSPACE_UNCONFIRMED_NOTE, type ChatActingScope } from './chat-acting-scope';
import { vaultDocEnabledFor } from '@/lib/vault/flags';

export const CREATE_DOCUMENT = 'create_document';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const str = { type: 'string' };
const cites = { type: 'array', items: { type: 'string' }, description: 'Source ids from doc_model.sources that support this statement.' };
const claim = { type: 'string', enum: [...CLAIM_VALUES], description: "fact = cites a source; assumption = a planning premise (add origin if uncited); recommendation; unverified; context = only in a role 'about' section, no numbers." };

/** The document schema the model fills, with every allowed value stated (live failure 2026-11-17: guessed source kinds were refused). */
const DOC_MODEL_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    subtitle: str,
    preparedFor: str,
    sources: {
      type: 'array',
      description: 'Every source a fact cites. kind must be one of the listed values (an uploaded file is "upload", a Vault document "vault", USAspending/FPDS award data "usaspending", a SAM.gov notice "sam_notice").',
      items: {
        type: 'object',
        properties: { id: str, label: str, kind: { type: 'string', enum: [...SOURCE_KIND_VALUES] }, url: str, retrievedAt: { type: 'string', description: 'YYYY-MM-DD' }, recordId: str },
        required: ['id', 'label', 'kind'],
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str,
          heading: str,
          role: { type: 'string', enum: ['about'], description: "Only for a short 'how to read / method / limitations' section." },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: [...BLOCK_TYPE_VALUES] },
                id: str,
                text: str,
                claim,
                cites,
                origin: { type: 'string', description: 'For an uncited assumption: where it comes from (e.g. "This analysis models these figures; they were not verified against the customer\'s records.").' },
                critical: { type: 'boolean', description: 'True when the statement drives a decision (a dollar figure, deadline, eligibility rule).' },
                tone: { type: 'string', enum: ['note', 'warning', 'key_finding'] },
                ordered: { type: 'boolean' },
                items: { type: 'array', items: { type: 'object', properties: { text: str, claim, cites, origin: str }, required: ['text', 'claim'] } },
                caption: str,
                columns: { type: 'array', items: { type: 'object', properties: { key: str, label: str, format: { type: 'string', enum: ['text', 'usd', 'int', 'pct', 'date'] }, align: { type: 'string', enum: ['left', 'right'] } }, required: ['key', 'label'] } },
                rows: { type: 'array', items: { type: 'object' } },
                kind: { type: 'string', enum: ['bar', 'line', 'pie'] },
                valueFormat: { type: 'string', enum: ['usd', 'int', 'pct'] },
                xLabel: str,
                yLabel: str,
                series: { type: 'array', items: { type: 'object', properties: { name: str, points: { type: 'array', items: { type: 'object', properties: { x: str, y: { type: 'number' } }, required: ['x', 'y'] } } }, required: ['name', 'points'] } },
              },
              required: ['type', 'id'],
            },
          },
        },
        required: ['id', 'heading', 'blocks'],
      },
    },
  },
  required: ['title', 'sources', 'sections'],
};

export const CREATE_DOCUMENT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: CREATE_DOCUMENT,
    description:
      "Create a document file — a client-ready PDF and an editable Word file — and save it privately to the user's Vault. CALL THIS whenever the user asks to create, make, write up, export, download or save a document, report, PDF, Word file, capability statement, brief or deliverable. Build it from the content already prepared in this conversation — INCLUDING the user's uploaded company material (capabilities, approach, company facts) and any rewrite you just gave them — not only the market research; do not run new searches first unless the user asks for new research. The user's own description of their company from their upload is a 'fact' that cites the upload: declare a source { kind: 'upload', recordId: <the upload's document_id>, label: <file name> } and cite it; never label it an assumption and never leave it out. Certifications, contract awards, past performance and eligibility may appear ONLY when the uploaded text states them, as facts citing the upload — never invented and never as assumptions. Label every block (an uncited fact is saved labeled \"Unverified — no source\"). Every declared source should be cited by at least one block. To revise a document Mindy made earlier, pass its document_id as revises_document_id: a new version is saved and the old one is kept.",
    parameters: {
      type: 'object',
      properties: {
        doc_model: DOC_MODEL_SCHEMA,
        revises_document_id: { type: 'string', description: 'The document_id of a document Mindy generated earlier, when this is a revision of it.' },
        theme: { type: 'string', enum: ['mindy', 'briefing'], description: "Visual style. Default 'mindy'." },
      },
      required: ['doc_model'],
      additionalProperties: false,
    },
  },
};

/** Common names a model uses for a source kind → the engine's value. Anything else stays as given (and is refused with the allowed values). */
const KIND_SYNONYMS: Record<string, (typeof SOURCE_KIND_VALUES)[number]> = {
  uploaded_file: 'upload', uploaded: 'upload', file: 'upload', document: 'upload', attachment: 'upload', uploaded_document: 'upload', user_upload: 'upload',
  federal_data: 'usaspending', fpds: 'usaspending', 'usaspending.gov': 'usaspending', usa_spending: 'usaspending', award_data: 'usaspending', awards: 'usaspending',
  sam: 'sam_notice', 'sam.gov': 'sam_notice', sam_gov: 'sam_notice', notice: 'sam_notice', solicitation: 'sam_notice', sam_opportunity: 'sam_notice',
  vault_document: 'vault', my_vault: 'vault',
  website: 'web', url: 'web', internet: 'web', mindy_tool: 'tool', mindy: 'tool',
};
export function normalizeSourceKind(kind: unknown): unknown {
  if (typeof kind !== 'string') return kind;
  const k = kind.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((SOURCE_KIND_VALUES as readonly string[]).includes(k)) return k;
  return KIND_SYNONYMS[k] ?? kind;
}

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

/**
 * EVERY string that can appear in the rendered files — what the CUI/classified detector must see (A4):
 * the readable text above PLUS table column labels and every cell value, chart series names, point
 * labels and axis titles, source labels / record ids / urls, and the cover "Attention" line. A marking
 * copied into a table or the Sources list must not reach a saved client file. One string per line, so
 * a banner keeps its own line for the line-based detector.
 */
export function markingText(m: DocModel): string {
  const parts: string[] = [docModelText(m), String((m.meta as { attention?: unknown } | undefined)?.attention ?? '')];
  for (const s of m.sections) {
    for (const b of s.blocks) {
      if (b.type === 'table') {
        for (const c of b.columns ?? []) parts.push(String(c.label ?? ''));
        for (const r of b.rows ?? []) for (const v of Object.values(r ?? {})) if (v !== null && v !== undefined) parts.push(String(v));
      } else if (b.type === 'chart') {
        parts.push(String(b.xLabel ?? ''), String(b.yLabel ?? ''));
        for (const ser of b.series ?? []) {
          parts.push(String(ser.name ?? ''));
          for (const pt of ser.points ?? []) parts.push(String(pt.x ?? ''));
        }
      }
    }
  }
  for (const src of m.sources ?? []) parts.push(String(src.label ?? ''), String(src.recordId ?? ''), String(src.url ?? ''));
  return parts.filter(Boolean).join('\n');
}

const baseName = (f: string) => f.replace(/\.(pdf|docx)$/i, '');

/**
 * Do the CUSTOMER's own words ask for a document file? Only then does the planner see uploaded text (and
 * the longer latest answer). Uploaded text in the planner is a prompt-injection surface, so it is given
 * only on the turns that need it — and on those turns create_document is the only write tool.
 */
const DOC_VERB = /\b(?:create|make|write\s+up|export|download|save|generate|produce|draft|build|turn\s+(?:this|that|it)\s+into|put\s+(?:this|that|it)\s+(?:in|into)|give\s+me)\b/i;
const DOC_NOUN = /\b(?:document|doc|docx|report|pdf|word(?:\s+(?:doc|file|document))?|file|capability\s+statement|cap\s+statement|brief|one[-\s]?pager|deliverable|white\s*paper)\b/i;
export function isDocumentCreationRequest(customerWords: string): boolean {
  const t = (customerWords || '').slice(0, 2000);
  const verb = DOC_VERB.exec(t);
  if (!verb) return false;
  // The document word must come after the verb, within the same sentence.
  const rest = t.slice(verb.index, verb.index + 160).split(/[.?!\n]/)[0];
  return DOC_NOUN.test(rest);
}

/** Labeled units in a model (a bullet item counts as one), for diagnostics. */
function countUnits(m: DocModel): number {
  let n = 0;
  for (const s of m.sections ?? []) for (const b of s.blocks ?? []) n += labeledUnits(b).length;
  return n;
}

export function makeGenerateDocumentTool(deps: GenerateDocumentDeps) {
  const owner = vaultEmailFor(deps.scope);
  const workspaceNote = deps.scope.kind === 'client' ? { workspace: 'client' as const } : {};

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
      ...(Array.isArray((raw as { sources?: unknown }).sources)
        ? { sources: ((raw as { sources: Array<Record<string, unknown>> }).sources).map((src) => (src && typeof src === 'object' ? { ...src, kind: normalizeSourceKind(src.kind) } : src)) }
        : {}),
    } as unknown as DocModel;

    const markers = fixtureMarkers(model);
    if (markers.length) return { ok: false, error: 'fixture_content', note: 'Example or test content cannot be saved as a document. Use the research from this conversation.' };

    // One call, one answer (Ask Mindy runs ONE tool round per turn, so a "fix and call again" retry is
    // unreachable live — 2026-11-17 production test). When the only problems are unsupported facts, the
    // document is repaired right away: uncited facts are saved labeled "Unverified — no source" and
    // decision-critical ones are omitted (never refused just because a fact lacked a cite). Anything the
    // repair cannot fix — structure, unknown values — is refused with the exact allowed values.
    // Diagnostics (no content): what came in, what the repair changed and why, and declared sources nothing cites.
    const unitsIn = countUnits(model);
    const omittedByReason: Record<string, number> = {};
    const preRepair = new Map<string, { claim?: string; text: string; critical?: boolean; cites?: string[] }>();
    for (const sec of model.sections ?? []) for (const b of sec.blocks ?? []) for (const u of labeledUnits(b)) preRepair.set(u.where, u);
    let v = validateDocModel(model);
    let unverified: string[] = [];
    let omitted: string[] = [];
    if (!v.ok) {
      const d = demoteUncitedFacts(model);
      const repaired = validateDocModel(d.model);
      if (!repaired.ok) {
        return {
          ok: false,
          error: 'invalid_document',
          issues: repaired.issues.slice(0, 25).map((i) => `${i.path}: ${i.message}`),
          allowed: { source_kind: [...SOURCE_KIND_VALUES], claim: [...CLAIM_VALUES], block_type: [...BLOCK_TYPE_VALUES] },
          note: 'The document could not be built and nothing was saved. Fix exactly these fields using the allowed values, then the user can ask again.',
        };
      }
      model = d.model; unverified = d.unverified; omitted = d.omitted; v = repaired;
      const ids = new Set((model.sources ?? []).map((s) => s.id));
      for (const where of omitted) {
        const u = preRepair.get(where);
        const reason = !u ? 'unknown'
          : u.claim === 'assumption' && neverAnAssumption(u.text) ? 'never_an_assumption'
            : citedObservationAsAssumption({ claim: u.claim, cites: u.cites, text: u.text }, ids) ? 'cited_observation_as_assumption'
              : u.critical === true ? 'critical_without_source' : 'other';
        omittedByReason[reason] = (omittedByReason[reason] ?? 0) + 1;
      }
    }
    const citedIds = new Set<string>();
    for (const sec of model.sections) for (const b of sec.blocks) for (const u of labeledUnits(b)) for (const c of u.cites ?? []) citedIds.add(c);
    const uncitedSources = model.sources.filter((s) => !citedIds.has(s.id)).map((s) => ({ id: s.id, kind: s.kind, label: s.label }));
    const diagnostics = { units_in: unitsIn, units_out: countUnits(model), unverified: unverified.length, omitted_by_reason: omittedByReason, uncited_sources: uncitedSources.map((s) => `${s.id}:${s.kind}`) };
    console.info('[create_document] diagnostics', JSON.stringify(diagnostics));
    // Method boilerplate repeated across sections is reported, never a reason to refuse or cut.
    const repeats = repeatedSentences(model);

    const text = docModelText(model);
    const marking = detectProhibitedMarkings(markingText(model));
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
      ...(repeats.length ? { repeated_sentences: repeats.length } : {}),
      diagnostics,
      note: 'Saved privately to the Vault (Documents → Generated). Tell the user the file names and that they can download them there; do not paste download links.'
        + (unverified.length ? ` ${unverified.length} statement(s) are labeled "Unverified — no source"; say so.` : '')
        + (omitted.length ? ` ${omitted.length} decision-critical statement(s) without a source were left out; say so.` : '')
        + (uncitedSources.some((s) => s.kind === 'upload')
          ? ` Warning: the uploaded file(s) ${uncitedSources.filter((s) => s.kind === 'upload').map((s) => `"${s.label}"`).join(', ')} were declared as sources but NO block cites them, so the document does not include their content. Tell the user plainly and offer to make a new version that includes it.`
          : uncitedSources.length ? ` Note: ${uncitedSources.length} declared source(s) are not cited by any block.` : ''),
    };
  }

  return { execute };
}
