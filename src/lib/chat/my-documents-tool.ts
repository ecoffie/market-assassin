/**
 * Ask Mindy tool `find_my_documents` — find a document the user saved in their Vault and read the
 * parts of it that answer the question.
 *
 * Two steps, never the whole Vault:
 *   1. METADATA match over the acting scope's non-archived Vault documents (file name words, class,
 *      this conversation, newest first). Only metadata comes back.
 *   2. EXCERPTS from ONE document — when the model names it by id, or when exactly one document
 *      matched — selected for the question (src/lib/text/select-relevant.ts) and fenced as untrusted
 *      data (src/lib/chat/untrusted-text.ts, the #2091 pattern). Several matches → the result says to
 *      ask the user which one; no text is read.
 *
 * Scope: the acting scope's Vault only (vaultEmailFor). An unconfirmed workspace reads nothing. The
 * model cannot pass an owner; the closure holds it. Free: a lookup or reopen is not an analysis.
 */
import { vaultEmailFor, WORKSPACE_UNCONFIRMED_NOTE, type ChatActingScope } from './chat-acting-scope';
import { fenceUntrusted, UNTRUSTED_TEXT_RULE } from './untrusted-text';
import { selectRelevantRfp } from '@/lib/text/select-relevant';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MyDocsDb = { from(table: string): any };

export const FIND_MY_DOCUMENTS = 'find_my_documents';
const MAX_CANDIDATES = 8;
const EXCERPT_BUDGET = 6_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOP = new Set(['the', 'a', 'an', 'my', 'our', 'doc', 'docs', 'document', 'documents', 'file', 'files', 'pdf', 'docx', 'word', 'that', 'this', 'from', 'for', 'of', 'and', 'uploaded', 'saved', 'attached']);

export const MY_DOCUMENTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: FIND_MY_DOCUMENTS,
    description:
      "Find a document the user saved in their private Vault (files they uploaded, files attached in Ask Mindy, files Mindy generated) and read the parts relevant to their question. Search by words from the file name, optionally narrowed to this conversation or a class. If several documents match, the result lists them: ask the user which one and call again with its document_id. Only passages are returned, never whole files. Quote only what is returned and attribute it to the file name. Documents uploaded in THIS conversation are already provided to you; use this for documents saved earlier.",
    parameters: {
      type: 'object',
      properties: {
        name_words: { type: 'string', description: "Words from the file name as the user said them (e.g. 'capability statement', 'Fort Bragg SOW')." },
        document_id: { type: 'string', description: 'The id of one document from a previous find_my_documents result, to read its passages.' },
        question: { type: 'string', description: "The user's question, used to pick the relevant passages." },
        doc_class: { type: 'string', enum: ['company', 'reference', 'generated'], description: 'Optional: company material, a reference file attached in chat, or a file Mindy generated.' },
        this_conversation_only: { type: 'boolean', description: 'Only documents attached in this conversation.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

type DocRow = {
  id: string; original_filename: string; doc_class: string | null; source: string | null;
  chat_session_id: string | null; created_at: string; page_count: number | null; extracted_text?: string | null;
};
const META = 'id, original_filename, doc_class, source, chat_session_id, created_at, page_count';

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

export function makeMyDocumentsTool(db: MyDocsDb, scope: ChatActingScope, opts: { chatSessionId: string | null }) {
  const owner = vaultEmailFor(scope);
  const workspaceNote = scope.kind === 'client' ? { workspace: 'client' as const } : {};

  const meta = (r: DocRow) => ({
    document_id: r.id,
    file_name: r.original_filename,
    kind: r.doc_class === 'reference' ? 'reference' : r.doc_class === 'generated' ? 'generated' : 'company',
    saved: r.created_at,
    pages: r.page_count ?? null,
    from_this_conversation: !!opts.chatSessionId && r.chat_session_id === opts.chatSessionId,
  });

  async function excerpts(row: DocRow, question: string): Promise<Record<string, unknown>> {
    const text = String(row.extracted_text || '');
    if (!text.trim()) return { ok: true, ...workspaceNote, document: meta(row), count: 0, note: 'This document has no readable text saved.' };
    const q = question.trim();
    const picked = q ? selectRelevantRfp(text, q, EXCERPT_BUDGET) : text.slice(0, EXCERPT_BUDGET);
    return {
      ok: true,
      ...workspaceNote,
      document: meta(row),
      rule: UNTRUSTED_TEXT_RULE,
      excerpts: fenceUntrusted(picked, { name: row.original_filename, chars: text.length, excerpted: picked.length < text.length, truncatedAtUpload: false }),
      ...(picked.trim() ? {} : { note: 'No passage matched the question. Say so; do not guess what the document contains.' }),
    };
  }

  async function execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!owner) return { ok: false, error: 'workspace_unavailable', count: 0, items: [], note: WORKSPACE_UNCONFIRMED_NOTE };
    const question = typeof args?.question === 'string' ? args.question.slice(0, 500) : '';

    // Step 2 directly: a named document, owner-checked in the query itself.
    if (typeof args?.document_id === 'string' && args.document_id.trim()) {
      const id = args.document_id.trim();
      if (!UUID_RE.test(id)) return { ok: false, error: 'not_found', note: 'No saved document has that id. Search by name instead.' };
      const { data, error } = await db.from('user_boilerplate_docs').select(`${META}, extracted_text`)
        .eq('id', id).eq('user_email', owner).is('archived_at', null).maybeSingle();
      if (error) return { ok: false, error: 'documents_unavailable', ...workspaceNote };
      if (!data) return { ok: false, error: 'not_found', note: 'No saved document has that id in this workspace.' };
      return excerpts(data as DocRow, question);
    }

    // Step 1: metadata only.
    if (args?.this_conversation_only === true && !opts.chatSessionId) {
      return { ok: true, ...workspaceNote, count: 0, items: [], note: 'This conversation has no saved documents yet.' };
    }
    let q = db.from('user_boilerplate_docs').select(META).eq('user_email', owner).is('archived_at', null);
    const cls = args?.doc_class;
    if (cls === 'reference' || cls === 'generated') q = q.eq('doc_class', cls);
    else if (cls === 'company') q = q.or('doc_class.is.null,doc_class.eq.company');
    if (args?.this_conversation_only === true) q = q.eq('chat_session_id', opts.chatSessionId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
    if (error) return { ok: false, error: 'documents_unavailable', ...workspaceNote };
    const rows = (data as DocRow[]) || [];
    const terms = typeof args?.name_words === 'string' ? words(args.name_words) : [];
    const scored = rows
      .map((r) => ({ r, hits: terms.filter((t) => words(r.original_filename).some((w) => w.startsWith(t) || t.startsWith(w))).length }))
      .filter((x) => terms.length === 0 || x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    if (scored.length === 0) {
      return { ok: true, ...workspaceNote, count: 0, items: [], note: terms.length ? 'No saved document name matches those words. Say so and ask the user for the file name; do not guess.' : 'No saved documents in this workspace.' };
    }
    const best = scored[0].hits;
    const top = terms.length ? scored.filter((x) => x.hits === best) : scored;
    if (top.length === 1 && terms.length) {
      // Exactly one match: read its passages (owner-checked again by id).
      const { data: full, error: fullErr } = await db.from('user_boilerplate_docs').select(`${META}, extracted_text`)
        .eq('id', top[0].r.id).eq('user_email', owner).is('archived_at', null).maybeSingle();
      if (fullErr || !full) return { ok: false, error: 'documents_unavailable', ...workspaceNote };
      return excerpts(full as DocRow, question);
    }
    return {
      ok: true,
      ...workspaceNote,
      count: Math.min(top.length, MAX_CANDIDATES),
      items: top.slice(0, MAX_CANDIDATES).map((x) => meta(x.r)),
      more: top.length > MAX_CANDIDATES,
      note: 'More than one saved document matches. List them by file name and date and ask the user which one; then call find_my_documents with that document_id. Do not read or summarize any of them yet.',
    };
  }

  return { execute };
}
