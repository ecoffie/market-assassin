/**
 * MCP tool: get_solicitation_documents — hand an external agent the FULL text
 * and downloadable raw files for a SAM notice, so it can pipe them anywhere
 * (Canva, an LLM, a proposal drafter). This is the "get our docs OUTSIDE Mindy"
 * capability.
 *
 * Returns: notice metadata + inline body/SOW text + a `documents[]` list, each
 * with inline extracted_text (capped) AND a short-lived signed `download_url` to
 * our stored copy of the raw PDF/DOCX (SAM API key stays server-side). Cold
 * notices are fetched + extracted ON DEMAND (public SAM attachments) and cached.
 *
 * Wraps src/lib/sam/solicitation-documents.ts. credits: 10 (premium delivery;
 * cold path downloads + extracts). `_meta` always ships; `_ai_hint` OFF by
 * default. SAM attachments are PUBLIC federal data — no tier gate.
 */
import {
  getSolicitationDocuments,
  type SolicitationDocument,
  type ListedAttachment,
  type SolicitationDocumentsResult,
  type DocTextRequest,
} from '@/lib/sam/solicitation-documents';
import { mcpFlags } from '@/lib/mcp/flags';
import { issueContinuation, verifyContinuation, MAX_FREE_CONTINUATIONS } from '@/lib/mcp/doc-continuation';

export interface SolicitationDocumentsToolInput {
  notice_id: string;
  /** Chars of text PER DOCUMENT in this response (default 20k, max 120k per document — not a total response cap). */
  text_limit?: number;
  /** Start offset, applied to every document unless overridden per-document. */
  text_offset?: number;
  /** Per-document windows: [{ document_id, offset, limit }]. */
  documents?: DocTextRequest[];
  /** Restrict the response to these document_ids — page one big doc cheaply. */
  document_ids?: string[];
  /** Opaque token from the previous response's next_page — marks this call as a continuation. */
  continuation?: string;
  /** The verified caller (dispatcher-supplied, never from args) — binds continuation tokens. */
  userEmail?: string;
}

/**
 * Is the statement of work / PWS / SOO in THIS response's package?
 *   found     — notice SOW text, or a file classified sow_pws.
 *   not_found — ESTABLISHED: every file in this version was received and classified, none is a
 *               scope document, and the notice carries no SOW text.
 *   unknown   — some file could not be read/classified, or the fetch was degraded/scoped, so
 *               absence cannot be claimed.
 */
export interface ScopeDocumentSignal {
  status: 'found' | 'not_found' | 'unknown';
  /** Filenames classified as the scope document (status=found). */
  files: string[];
  note: string;
}

export interface SolicitationDocumentsToolResult {
  notice_id: string;
  title: string | null;
  solicitation_number: string | null;
  agency: string | null;
  description: string;
  description_truncated: boolean;
  sow_text: string;
  sow_text_truncated: boolean;
  documents: SolicitationDocument[];
  /** Completeness of THIS response. `next_page === null` is the terminator. */
  coverage: SolicitationDocumentsResult['coverage'];
  /** Ready-to-send continuation, scoped to the docs that still have text. */
  next_page: { notice_id: string; document_ids: string[]; documents: DocTextRequest[]; continuation?: string } | null;
  /** Whether the statement of work / PWS is in this package (see ScopeDocumentSignal). */
  scope_document: ScopeDocumentSignal;
  listed_attachments: ListedAttachment[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    doc_count: number;
    source: 'cache' | 'on_demand' | 'none';
    signed_url_ttl_seconds: number;
    /** Chars delivered in this response across all documents. */
    returned_chars: number;
    /** True stored chars across all documents; null where any is unknown. */
    total_chars: number | null;
    coverage_complete: boolean;
    attachments_listed: number;
    attachments_with_text: number;
    piee: boolean;
    piee_links: string[];
    retrieval_limitation: string | null;
    /** Continuation page this response served (null = a new retrieval). */
    continuation_page: number | null;
    /** True when next_page exists but the continuation cap for this retrieval was reached. */
    continuation_cap_reached: boolean;
  };
}

const SCOPE_NOTE_NOT_FOUND =
  "No statement of work, PWS or SOO was found in this version's notice text or files. Say so instead of paging " +
  'through other documents to look for it; it may be in an earlier version of this solicitation.';

/** Exported for tests. */
export function scopeDocumentSignal(res: Pick<SolicitationDocumentsResult, 'sow_text' | 'documents' | 'coverage' | 'degraded' | 'listed_attachments' | 'attachments_listed' | 'attachments_with_text' | 'piee' | 'retrieval_limitation'>): ScopeDocumentSignal {
  const scopeFiles = res.documents.filter((d) => d.doc_kind === 'sow_pws').map((d) => d.filename ?? d.document_id);
  if (res.sow_text.length > 0 || scopeFiles.length > 0) {
    return {
      status: 'found',
      files: scopeFiles,
      note: scopeFiles.length > 0 ? `Scope document: ${scopeFiles.join(', ')}.` : 'The notice carries statement-of-work text (sow_text).',
    };
  }
  const everyFileRead =
    !res.degraded &&
    !res.piee &&
    !res.retrieval_limitation &&
    !res.coverage.scoped &&
    res.coverage.documents_unavailable === 0 &&
    res.attachments_with_text >= res.attachments_listed &&
    // documents_unavailable already counts file_unavailable / extraction_failed / container_stub /
    // unreadable_encoding (summarize() in the lib). A file with no kind was never classified.
    res.documents.every((d) => d.doc_kind !== null);
  return everyFileRead
    ? { status: 'not_found', files: [], note: SCOPE_NOTE_NOT_FOUND }
    : {
        status: 'unknown',
        files: [],
        note: 'Not every file in this version could be read and classified, so whether a statement of work is present is not established.',
      };
}

export async function solicitationDocuments(
  input: SolicitationDocumentsToolInput,
): Promise<SolicitationDocumentsToolResult> {
  const noticeId = (input.notice_id || '').trim();
  const res = await getSolicitationDocuments({
    noticeId,
    textLimit: input.text_limit,
    textOffset: input.text_offset,
    documents: input.documents,
    documentIds: input.document_ids,
  });

  // A continuation presents the token the previous response issued; verify it here so the
  // next token carries the right page number. (Billing reads the same verdict, pre-run.)
  const verdict = input.userEmail
    ? verifyContinuation(input.continuation, { userEmail: input.userEmail, windows: input.documents, documentIds: input.document_ids })
    : ({ ok: false, reason: 'absent' } as const);
  const continuationPage = verdict.ok ? verdict.page : null;

  const hasText = res.sow_text.length > 0 || res.description.length > 0;
  const grounded = res.documents.length > 0 || hasText;

  // Hand back the EXACT continuation call rather than making the agent compute
  // offsets. Only documents with text still unread are listed.
  const more = res.documents.filter((d) => d.text_window.has_more && d.text_window.next_offset !== null);
  const nextPageBase =
    more.length > 0
      ? {
          notice_id: res.notice_id,
          // SCOPE the continuation to only the documents that still have text.
          // Without document_ids the next call re-sends every COMPLETED document
          // from offset 0, which both wastes the response budget and makes naive
          // accumulation double-count them (caught by the VA acceptance case).
          document_ids: more.map((d) => d.document_id),
          documents: more.map((d) => ({
            document_id: d.document_id,
            offset: d.text_window.next_offset as number,
            // Carry the window size the caller actually used for THIS document
            // (per-doc spec first, then the request default). Hardcoding the
            // 20k default here silently shrank a 120k reader to 20k on its own
            // continuation, turning a 3-call read into a 15-call one.
            limit:
              input.documents?.find((r) => r.document_id === d.document_id)?.limit ??
              input.documents?.find((r) => !r.document_id)?.limit ??
              input.text_limit ??
              20_000,
          })),
        }
      : null;
  const nextToken = nextPageBase && input.userEmail
    ? issueContinuation(input.userEmail, nextPageBase.documents, (continuationPage ?? 0) + 1)
    : null;
  const nextPage = nextPageBase ? { ...nextPageBase, ...(nextToken ? { continuation: nextToken } : {}) } : null;
  const capReached = !!nextPageBase && !!input.userEmail && (continuationPage ?? 0) >= MAX_FREE_CONTINUATIONS;
  const scope = scopeDocumentSignal(res);

  const result: SolicitationDocumentsToolResult = {
    notice_id: res.notice_id,
    title: res.title,
    solicitation_number: res.solicitation_number,
    agency: res.agency,
    description: res.description,
    description_truncated: res.description_truncated,
    sow_text: res.sow_text,
    sow_text_truncated: res.sow_text_truncated,
    documents: res.documents,
    coverage: res.coverage,
    next_page: nextPage,
    scope_document: scope,
    listed_attachments: res.listed_attachments,
    _meta: {
      grounded,
      degraded: res.degraded,
      doc_count: res.documents.length,
      source: res.source,
      signed_url_ttl_seconds: 3600,
      returned_chars: res.documents.reduce((n, d) => n + d.text_window.returned_chars, 0),
      // null if ANY document's length is unknown — a partial sum would read as a total.
      total_chars: res.documents.some((d) => d.text_window.total_chars === null)
        ? null
        : res.documents.reduce((n, d) => n + (d.text_window.total_chars || 0), 0),
      coverage_complete: res.coverage.complete,
      attachments_listed: res.attachments_listed,
      attachments_with_text: res.attachments_with_text,
      piee: res.piee,
      piee_links: res.piee_links,
      retrieval_limitation: res.retrieval_limitation,
      continuation_page: continuationPage,
      continuation_cap_reached: capReached,
    },
  };

  if (mcpFlags.aiHint) {
    // The classifier's kind is 'sow_pws' (src/lib/proposal/classify-doc.ts); this used to look
    // for 'sow' | 'pws', which never matched, so the hint never named the scope document.
    const sowDoc = res.documents.find((d) => d.doc_kind === 'sow_pws');
    result._ai_hint = {
      summary: res.degraded
        ? 'Document fetch partially failed — some attachments could not be downloaded/extracted; retry before concluding there are no docs.'
        : grounded
        ? `${res.documents.length} document(s) for notice ${res.notice_id}${res.title ? ` — "${res.title}"` : ''}. ${sowDoc ? `Scope doc: ${sowDoc.filename}. ` : ''}${
            nextPage
            ? `PARTIAL: ${res.coverage.documents_with_more_text} document(s) have more text — page on only if the question needs it.`
            : 'Nothing further to read: next_page is null.'
          }`
        : `No documents or text found for notice ${res.notice_id}. Verify the notice_id, or the notice may have no attachments.`,
      how_to_use: grounded
        ? 'extracted_text is ONE WINDOW of each document. Page only when the question needs more of a specific document: re-call with the ready-made `next_page` (pass its document_ids, documents AND continuation unchanged); next_page=null is the end of the package, not coverage.complete. For a summary or overview, read the first window of each file and say which files still have unread text rather than paging through all of them. If scope_document.status is not_found, say the statement of work is not in these files instead of paging to look for it. `coverage` describes the CURRENT response only (coverage.scoped=true means it covered part of the notice). Do NOT conclude a clause is absent from a partial window. text_availability says why text is or is not here: complete | partial (page on) | extraction_failed | file_unavailable | extraction_capped (the file tail was never extracted — only download_url can reach it). download_url is a short-lived (~1h) link to the raw PDF/DOCX.'
        : 'No grounded documents; tell the user none were found rather than inventing solicitation content.',
      key_caveats: [
        'next_page !== null means text is still unread — say so instead of implying you read the full package. coverage.complete describes THIS response, not everything you have read so far.',
        'A clause missing from a PARTIAL window is UNKNOWN, not absent. Do not state that a solicitation lacks something unless you have read to the end of that document.',
        'text_availability="extraction_capped" means the end of the FILE was never extracted; paging cannot recover it, the raw download can.',
        'Coverage is measured in CHARACTERS. Do NOT convert it to pages — no char→page mapping is stored, so "N of M pages" would be invented.',
        'download_url expires (~1h) — re-call the tool to mint a fresh link.',
        'extracted_text is truncated for inline delivery; the full text is in the downloadable file (char_count is the true length). Check location_note — a SAM.gov URL is an external attachment, not a Mindy-stored copy.',
        'Not every notice has attachments — an empty documents list can be legitimate (e.g. a Sources Sought with only body text).',
        ...(res.retrieval_limitation ? [res.retrieval_limitation] : []),
      ],
    };
  }
  return result;
}
