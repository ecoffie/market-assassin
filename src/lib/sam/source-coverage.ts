/**
 * Source coverage for tools that DERIVE something from a solicitation's text.
 *
 * WHY: a derived artifact is only as complete as the text it was built from, and
 * the caller cannot see that text. Without this, `extract_compliance_matrix`
 * returned a matrix from a partial read with no signal that whole sections of
 * the solicitation were never in the input — which is how a matrix comes back
 * citing a "Section L.3.2" that a FAR Part 12 commercial-item buy never had.
 *
 * This reports what the SOURCE was missing, which is distinct from the LLM's own
 * input truncation (`truncated`, the 50K chunk cap). Both can be true, and they
 * mean different things:
 *   truncated       → the model saw less than we gave it
 *   coverage.complete=false → we gave it less than the solicitation has
 */
import type { SolicitationDocumentsResult } from '@/lib/sam/solicitation-documents';

export interface SourceCoverage {
  /** Every document's full available text was in the derived input. */
  complete: boolean;
  documents_total: number;
  /** Documents whose text was cut short in the input (more exists). */
  documents_partial: number;
  /** Documents that yielded no usable text at all (see reasons). */
  documents_unreadable: number;
  /** Per-document detail, only for the ones that were NOT fully readable. */
  gaps: Array<{ filename: string; document_id: string; reason: string }>;
}

export function summarizeSourceCoverage(docs: SolicitationDocumentsResult): SourceCoverage {
  const gaps: SourceCoverage['gaps'] = [];
  let partial = 0;
  let unreadable = 0;

  for (const d of docs.documents) {
    switch (d.text_availability) {
      case 'complete':
        break;
      case 'partial':
      case 'extraction_capped':
        partial++;
        gaps.push({ filename: d.filename, document_id: d.document_id, reason: d.text_availability });
        break;
      default:
        // container_stub | unreadable_encoding | extraction_failed | file_unavailable
        unreadable++;
        gaps.push({ filename: d.filename, document_id: d.document_id, reason: d.text_availability });
    }
  }

  return {
    complete: docs.documents.length > 0 && partial === 0 && unreadable === 0,
    documents_total: docs.documents.length,
    documents_partial: partial,
    documents_unreadable: unreadable,
    gaps,
  };
}

/** One sentence a tool can paste into its _ai_hint so the gap is stated, not implied. */
export function coverageCaveat(c: SourceCoverage): string | null {
  if (c.complete || c.documents_total === 0) return null;
  const bits: string[] = [];
  if (c.documents_partial > 0) bits.push(`${c.documents_partial} document(s) only partially read`);
  if (c.documents_unreadable > 0) bits.push(`${c.documents_unreadable} document(s) yielded no usable text`);
  return (
    `SOURCE COVERAGE INCOMPLETE — ${bits.join(' and ')}. ` +
    `Requirements living in the unread portions are UNKNOWN, not absent: do not state that the ` +
    `solicitation lacks something on the strength of this output. Gaps: ` +
    c.gaps.map((g) => `${g.filename} (${g.reason})`).join('; ')
  );
}
