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
 * Wraps src/lib/sam/solicitation-documents.ts. credits: 3 (premium delivery;
 * cold path downloads + extracts). `_meta` always ships; `_ai_hint` OFF by
 * default. SAM attachments are PUBLIC federal data — no tier gate.
 */
import { getSolicitationDocuments, type SolicitationDocument } from '@/lib/sam/solicitation-documents';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SolicitationDocumentsToolInput {
  notice_id: string;
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
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    doc_count: number;
    source: 'cache' | 'on_demand' | 'none';
    signed_url_ttl_seconds: number;
  };
}

export async function solicitationDocuments(
  input: SolicitationDocumentsToolInput,
): Promise<SolicitationDocumentsToolResult> {
  const noticeId = (input.notice_id || '').trim();
  const res = await getSolicitationDocuments({ noticeId });

  const hasText = res.sow_text.length > 0 || res.description.length > 0;
  const grounded = res.documents.length > 0 || hasText;

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
    _meta: {
      grounded,
      degraded: res.degraded,
      doc_count: res.documents.length,
      source: res.source,
      signed_url_ttl_seconds: 3600,
    },
  };

  if (mcpFlags.aiHint) {
    const sowDoc = res.documents.find((d) => d.doc_kind === 'sow' || d.doc_kind === 'pws');
    result._ai_hint = {
      summary: res.degraded
        ? 'Document fetch partially failed — some attachments could not be downloaded/extracted; retry before concluding there are no docs.'
        : grounded
        ? `${res.documents.length} document(s) for notice ${res.notice_id}${res.title ? ` — "${res.title}"` : ''}. ${sowDoc ? `Scope doc: ${sowDoc.filename}.` : ''} Inline text + signed download URLs (valid ~1h) provided.`
        : `No documents or text found for notice ${res.notice_id}. Verify the notice_id, or the notice may have no attachments.`,
      how_to_use: grounded
        ? 'extracted_text is the readable text INLINE (capped — check *_truncated). download_url is a short-lived signed link to the full raw PDF/DOCX; fetch it within ~1h to feed a design tool (Canva) or re-parse the full document. sow_text/description are the notice body. Prefer the SOW/PWS doc for the actual requirement.'
        : 'No grounded documents; tell the user none were found rather than inventing solicitation content.',
      key_caveats: [
        'download_url expires (~1h) — re-call the tool to mint a fresh link.',
        'extracted_text is truncated for inline delivery; the full text is in the downloadable file (char_count is the true length).',
        'Not every notice has attachments — an empty documents list can be legitimate (e.g. a Sources Sought with only body text).',
      ],
    };
  }
  return result;
}
