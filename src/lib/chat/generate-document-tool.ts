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
import { validateDocModel, demoteUncitedFacts, repairDocModelStructure, hardenedAssumptions, repeatedSentences, fixtureMarkers, neverAnAssumption, citedObservationAsAssumption, BLOCK_TYPE_VALUES, CLAIM_VALUES, SOURCE_KIND_VALUES } from '@/lib/documents/validate';
import { renderDocument } from '@/lib/documents';
import { modelHasTables } from '@/lib/documents/render-spreadsheet';
import { saveGeneratedDocument, type GeneratedDb, type GeneratedFormat } from '@/lib/vault/generated';
import type { VaultStorage, VaultUploadInput } from '@/lib/vault/upload';
import { detectProhibitedMarkings, markingRefusalMessage } from '@/lib/vault/marking-detect';
import { vaultEmailFor, WORKSPACE_UNCONFIRMED_NOTE, type ChatActingScope } from './chat-acting-scope';
import { vaultDocEnabledFor } from '@/lib/vault/flags';
import { validateFmpWriteup, type FmpWriteupContext } from './fmp-writeup-validate';

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
      "Create a document file — a client-ready PDF and an editable Word file (and Excel/CSV when the model has tables or the user asks for a spreadsheet) — and save it privately to the user's Vault. CALL THIS whenever the user asks to create, make, write up, export, download or save a document, report, PDF, Word file, Excel, spreadsheet, CSV, capability statement, brief or deliverable. Build it from the content already prepared in this conversation — INCLUDING the user's uploaded company material (capabilities, approach, company facts) and any rewrite you just gave them — not only the market research; do not run new searches first unless the user asks for new research. The user's own description of their company from their upload is a 'fact' that cites the upload: declare a source { kind: 'upload', recordId: <the upload's document_id>, label: <file name> } and cite it; never label it an assumption and never leave it out. Certifications, contract awards, past performance and eligibility may appear ONLY when the uploaded text states them, as facts citing the upload — never invented and never as assumptions. Label every block (an uncited fact is saved labeled \"Unverified — no source\"). Every declared source should be cited by at least one block. Write for a busy small-business owner who is not an AI expert: short sentences, plain English, no jargon without a one-line gloss in parentheses, concrete next steps. CHOOSING LENGTH: (1) If the user asks for a short strategy / capture / pursuit brief, use EXACTLY these body headings in order — 'About the company', 'Where demand is', 'How you fit', 'Next 30 days' — plus an optional role-'about' section 'How to read this'; keep each section to at most 3 short paragraphs or 1 table + 3 bullets. (2) If the user asks for a market research report, comprehensive report, full report, deep dive, or similar, DO NOT force that short brief shape — build a professional multi-section research report with a cover subtitle and an executive summary. ORDER: lead with the answer — the executive summary states the top prioritized opportunities and the recommended moves in plain English, followed by a 'Priority opportunities and recommendations' section (ranked; each with the buyer, why it fits, and the next step) — THEN the supporting evidence: agency/buyer analysis, contractor/competition tables, contract history when researched, then citations, assumptions and limits. PROCUREMENT PATHWAYS: when the conversation's tool results cover them, include a section on how the work is actually bought — contract vehicles / IDIQs / GWACs and who holds them now (current holders and incumbents), open sources-sought / RFI / pre-solicitation notices, forecasts, recompete and expiration timing, and the set-asides in play. Omit what was not researched or say plainly that it was not checked; never fill a gap with a guess. WHAT IT MEANS: do not stop at data. Turn the evidence into business meaning — where to compete, which buyers to approach first, which vehicles to get on, which incumbents to displace or team with, what drives the demand, and concrete next actions with a time frame; label these 'recommendation' and tie each to the facts that support it. CITATIONS: one source per underlying record when the tool results provide a record URL or id — a USAspending award page (usaspending.gov/award/...), a SAM.gov notice link, a vehicle or solicitation number — with kind, url and recordId filled in; a generic search-page URL (usaspending.gov/search) is only the fallback for an aggregate figure that has no record. Every figure cites the source it came from. Prefer real tables over long prose. PERCENT COLUMNS: format 'pct' (tables and charts) shows a value of 1 or less as a fraction (0.284 → 28.4%) and a value above 1 as percentage points (40.93 → 40.9%); state shares consistently in one style per column, and store a share under 1% as a fraction (0.005, not 0.5). IDS: give every section and block its own unique id (sec-exec-summary, sec-vehicles, blk-top-agencies-table); a repeated id is repaired by renaming, so never rely on one. Never invent federal dollars, award counts, or agency rankings; only include figures that appear in this conversation's tool results, and label estimates vs verified facts clearly. Title the document with the company or market name (not a bare 'Report'). To revise a document Mindy made earlier, pass its document_id as revises_document_id: a new version is saved and the old one is kept.",
    parameters: {
      type: 'object',
      properties: {
        doc_model: DOC_MODEL_SCHEMA,
        revises_document_id: { type: 'string', description: 'The document_id of a document Mindy generated earlier, when this is a revision of it.' },
        theme: { type: 'string', enum: ['mindy', 'briefing'], description: "Visual style. Default 'mindy'." },
        include_spreadsheet: {
          type: 'boolean',
          description: 'When true, also save Excel (.xlsx) and CSV. Pass true when the user asked for Excel/CSV/spreadsheet. Defaults to true when the document has table blocks (omit or true); pass false for Word/PDF only.',
        },
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
  /**
   * Federal Market Profile turn: run the step-8 write-up validator after DocModel
   * repair/validate/demote and BEFORE render/save. Hard failures return
   * `fmp_writeup_invalid` and save nothing.
   */
  federalMarketProfile?: boolean;
  /**
   * PAE section required when defenseBuyersAppear; optional requiredSnippets from
   * host-extracted tool JSON (FmpWriteupContext.requiredSnippets).
   */
  fmpWriteupContext?: FmpWriteupContext;
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

const baseName = (f: string) => f.replace(/\.(pdf|docx|xlsx|csv)$/i, '');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

/**
 * Do the CUSTOMER's own words ask for a document file? Only then does the planner see uploaded text (and
 * the longer latest answer). Uploaded text in the planner is a prompt-injection surface, so it is given
 * only on the turns that need it — and on those turns create_document is the only write tool.
 */
const DOC_VERB = /\b(?:create|make|write\s+up|export|download|save|generate|produce|draft|build|turn\s+(?:this|that|it)\s+into|put\s+(?:this|that|it)\s+(?:in|into)|give\s+me)\b/i;
const DOC_NOUN = /\b(?:document|doc|docx|report|pdf|word(?:\s+(?:doc|file|document))?|file|capability\s+statement|cap\s+statement|brief|one[-\s]?pager|deliverable|white\s*paper|excel|spreadsheet|xlsx|csv)\b/i;
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

  /** Same-basename siblings saved with `row` (same version + parent chain) — PDF/Word/Excel/CSV. */
  async function loadSiblings(row: Row): Promise<Row[]> {
    let q = deps.db.from('user_boilerplate_docs')
      .select('id, original_filename, mime_type, version, parent_id, doc_model')
      .eq('user_email', owner).eq('doc_class', 'generated').is('archived_at', null).eq('version', row.version ?? 1);
    q = row.parent_id ? q.eq('parent_id', row.parent_id) : q.is('parent_id', null);
    const { data, error } = await q.limit(20);
    if (error || !Array.isArray(data)) return [];
    const base = baseName(row.original_filename);
    return (data as Row[]).filter((r) => baseName(r.original_filename) === base);
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
    // unreachable live — 2026-11-17 production test). Repair shape first (duplicate ids / missing table
    // columns — live 2026-11-19 comprehensive report failures), then unsupported facts: uncited facts
    // are saved labeled "Unverified — no source" and decision-critical ones are omitted. Anything the
    // repair cannot fix — unknown values / empty content — is refused with the exact allowed values.
    // Diagnostics (no content): what came in, what the repair changed and why, and declared sources nothing cites.
    const structured = repairDocModelStructure(model);
    model = structured.model;
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
          ...(structured.changes.length ? { structure_repairs: structured.changes.slice(0, 20) } : {}),
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
    const diagnostics = {
      units_in: unitsIn,
      units_out: countUnits(model),
      unverified: unverified.length,
      omitted_by_reason: omittedByReason,
      uncited_sources: uncitedSources.map((s) => `${s.id}:${s.kind}`),
      structure_repairs: structured.changes.length,
    };
    console.info('[create_document] diagnostics', JSON.stringify(diagnostics));
    // Method boilerplate repeated across sections is reported, never a reason to refuse or cut.
    const repeats = repeatedSentences(model);

    // FMP step 8: structure + ban gate (Choice B). Soft em-dash replace; hard refuse on missing sections / CTAs.
    let fmpWarnings: string[] = [];
    if (deps.federalMarketProfile) {
      const fmpCtx: FmpWriteupContext = deps.fmpWriteupContext ?? { defenseBuyersAppear: false };
      const fmp = validateFmpWriteup(model, fmpCtx);
      if (fmp.model) model = fmp.model;
      const hard = fmp.issues.filter((i) => i.severity === 'error');
      fmpWarnings = fmp.issues.filter((i) => i.severity === 'warn').map((i) => i.message);
      if (hard.length) {
        return {
          ok: false,
          error: 'fmp_writeup_invalid',
          issues: hard.map((i) => `${i.code}: ${i.message}`),
          ...(fmpWarnings.length ? { warnings: fmpWarnings } : {}),
          note: 'Federal Market Profile write-up failed the structure gate. Nothing was saved. Fix the listed issues and call create_document once more.',
        };
      }
    }

    const text = docModelText(model);
    const marking = detectProhibitedMarkings(markingText(model));
    if (marking.blocked && marking.kind) return { ok: false, error: 'prohibited_marking', note: markingRefusalMessage(marking.kind) };

    // Revision: the parent (and its other-format siblings) must be this owner's generated document, and no
    // assumption may come back as a fact.
    let parentDocx: string | null = null;
    let parentPdf: string | null = null;
    let parentXlsx: string | null = null;
    let parentCsv: string | null = null;
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
      const siblings = await loadSiblings(parent);
      const byMime = (mime: string) => siblings.find((r) => r.mime_type === mime)?.id
        ?? (parent.mime_type === mime ? parent.id : null);
      parentDocx = byMime(DOCX_MIME);
      parentPdf = byMime('application/pdf');
      parentXlsx = byMime(XLSX_MIME);
      parentCsv = byMime(CSV_MIME) ?? byMime('text/csv');
    }

    const render = deps.render ?? renderDocument;
    const files: Array<Record<string, unknown>> = [];
    let version: number | null = null;
    const save = async (format: GeneratedFormat, bytes: Buffer, filename: string, parentId: string | null) => {
      const saved = await saveGeneratedDocument(
        { callerEmail: deps.callerEmail, request: deps.request, format, filename, bytes, docModel: model, text, parentId, chatSessionId: deps.chatSessionId },
        { db: deps.db, storage: deps.storage, resolveScope: async () => deps.scope },
      );
      if (!saved.ok) return saved;
      // Version comes from the Word save (primary). Later unparented spreadsheet v1s must not overwrite it.
      if (version == null) version = saved.version;
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

    // W4: Excel + CSV when the model has tables, the caller opts in, or a prior spreadsheet sibling exists.
    // Explicit false skips sheets even when tables exist (Word/PDF-only deliverable).
    const includeSpreadsheet = args?.include_spreadsheet === true
      || (args?.include_spreadsheet !== false && (modelHasTables(model) || !!parentXlsx || !!parentCsv));
    let spreadsheetNote: string | null = null;
    if (includeSpreadsheet) {
      const sheetFails: string[] = [];
      const xlsx = await render(model, 'xlsx');
      if (xlsx.ok && !xlsx.degraded) {
        const savedXlsx = await save('xlsx', xlsx.bytes, xlsx.filename, parentXlsx);
        if (!savedXlsx.ok) sheetFails.push('Excel');
      } else sheetFails.push('Excel');
      const csv = await render(model, 'csv');
      if (csv.ok && !csv.degraded) {
        const savedCsv = await save('csv', csv.bytes, csv.filename, parentCsv);
        if (!savedCsv.ok) sheetFails.push('CSV');
      } else sheetFails.push('CSV');
      if (sheetFails.length) {
        spreadsheetNote = `The ${sheetFails.join(' and ')} file(s) could not be saved; the Word${pdfNote ? '' : ' and PDF'} file(s) were saved.`;
      }
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
      ...(spreadsheetNote ? { spreadsheet_note: spreadsheetNote } : {}),
      ...(repeats.length ? { repeated_sentences: repeats.length } : {}),
      ...(fmpWarnings.length ? { fmp_warnings: fmpWarnings } : {}),
      diagnostics,
      note: 'Saved privately to the Vault (Documents → Generated). Under this answer the user gets an "Open report" card (on the Map the report also opens in a reading pane beside the chat). Tell them they can read it there, open Export in the report for PDF/Word/Excel/CSV, ask you for changes (a new version is saved, the old one is kept), or find it under Documents → Generated. Do not paste download links or list format buttons in the chat text.'
        + (unverified.length ? ` ${unverified.length} statement(s) are labeled "Unverified — no source"; say so.` : '')
        + (omitted.length ? ` ${omitted.length} decision-critical statement(s) without a source were left out; say so.` : '')
        + (uncitedSources.some((s) => s.kind === 'upload')
          ? ` Warning: the uploaded file(s) ${uncitedSources.filter((s) => s.kind === 'upload').map((s) => `"${s.label}"`).join(', ')} were declared as sources but NO block cites them, so the document does not include their content. Tell the user plainly and offer to make a new version that includes it.`
          : uncitedSources.length ? ` Note: ${uncitedSources.length} declared source(s) are not cited by any block.` : ''),
    };
  }

  return { execute };
}

/** One saved file from a successful create_document result (for the in-chat download chips). */
export type CreateDocumentDeliverable = {
  format: string;
  document_id: string;
  file_name?: string;
  version?: number;
  download_path?: string;
};

/**
 * Parse create_document tool JSON into the SSE `deliverables` payload.
 * Returns null when the result is not a successful save with at least one file id.
 */
export function parseCreateDocumentDeliverables(content: string): {
  files: CreateDocumentDeliverable[];
  pdf_note?: string;
  title?: string;
} | null {
  try {
    const p = JSON.parse(content) as {
      ok?: unknown;
      title?: unknown;
      pdf_note?: unknown;
      files?: unknown;
    };
    if (!p || p.ok !== true || !Array.isArray(p.files)) return null;
    const files: CreateDocumentDeliverable[] = [];
    for (const raw of p.files) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Record<string, unknown>;
      const document_id = typeof f.document_id === 'string' ? f.document_id.trim() : '';
      const format = typeof f.format === 'string' ? f.format.trim().toLowerCase() : '';
      if (!document_id || !format) continue;
      files.push({
        format,
        document_id,
        ...(typeof f.file_name === 'string' ? { file_name: f.file_name } : {}),
        ...(typeof f.version === 'number' ? { version: f.version } : {}),
        ...(typeof f.download_path === 'string' ? { download_path: f.download_path } : {}),
      });
    }
    if (!files.length) return null;
    return {
      files,
      ...(typeof p.pdf_note === 'string' && p.pdf_note.trim() ? { pdf_note: p.pdf_note.trim() } : {}),
      ...(typeof p.title === 'string' && p.title.trim() ? { title: p.title.trim() } : {}),
    };
  } catch {
    return null;
  }
}
