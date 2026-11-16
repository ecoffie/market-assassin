/**
 * Pursuit-document excerpts for Ask Mindy — the passages relevant to ONE question,
 * never whole files.
 *
 * Ask Mindy reads a pursuit's stored documents (pursuit_documents.extracted_text, the
 * same text Proposal AI uses) only after strong auth + an ownership check
 * (authorizePursuitRead). Even then it returns bounded excerpts: the model needs the
 * clause that answers the question, and a whole RFP in the transcript is both a
 * disclosure surface and a context-budget problem.
 *
 * Selection is deterministic and explainable: split each document at paragraph
 * boundaries (chunkText, shared with the compliance matrix), score a passage by how
 * many DISTINCT question terms it contains (word-boundary match), keep the best few.
 * A passage with no question term is never returned — no filler.
 */
import { chunkText } from '@/lib/proposal/compliance-matrix';

export interface PursuitDocText {
  filename: string;
  doc_kind?: string | null;
  extracted_text: string | null;
}

export interface PursuitDocExcerpt {
  filename: string;
  doc_kind: string | null;
  passage: number;
  matched_terms: string[];
  text: string;
}

// 500 = chat's LONG_STRING_CHARS (bound-tool-result.ts): a longer excerpt would be clipped
// mid-passage before the model saw it.
export const EXCERPT_CHARS = 500;
export const MAX_EXCERPTS = 6;
export const MAX_TOTAL_CHARS = 3000;

const STOP = new Set([
  'the', 'and', 'for', 'are', 'what', 'which', 'who', 'how', 'does', 'did', 'this', 'that', 'with', 'from',
  'they', 'their', 'there', 'about', 'into', 'have', 'has', 'any', 'all', 'can', 'will', 'would', 'should',
  'when', 'where', 'why', 'our', 'your', 'you', 'its', 'was', 'were', 'is', 'be', 'it', 'of', 'to', 'in',
  'on', 'or', 'an', 'as', 'at', 'by', 'me', 'my', 'we', 'us', 'say', 'says', 'tell', 'show', 'find', 'need',
  'document', 'documents', 'doc', 'docs', 'rfp', 'solicitation', 'pursuit', 'file', 'files', 'please',
]);

export function questionTerms(question: string): string[] {
  const terms = String(question || '')
    .toLowerCase()
    .split(/[^a-z0-9.\-]+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOP.has(t));
  return [...new Set(terms)].slice(0, 12);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function selectPursuitDocExcerpts(
  docs: PursuitDocText[],
  question: string,
): { excerpts: PursuitDocExcerpt[]; terms: string[]; truncated: boolean } {
  const terms = questionTerms(question);
  if (terms.length === 0) return { excerpts: [], terms, truncated: false };
  const matchers = terms.map((t) => ({ t, re: new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, 'i') }));

  const scored: Array<PursuitDocExcerpt & { score: number; order: number }> = [];
  let order = 0;
  for (const d of docs) {
    const text = (d.extracted_text || '').trim();
    if (!text) continue;
    chunkText(text, EXCERPT_CHARS).forEach((chunk, i) => {
      const matched = matchers.filter((m) => m.re.test(chunk)).map((m) => m.t);
      order += 1;
      if (matched.length === 0) return;
      scored.push({
        filename: d.filename,
        doc_kind: d.doc_kind ?? null,
        passage: i + 1,
        matched_terms: matched,
        text: chunk.slice(0, EXCERPT_CHARS),
        score: matched.length,
        order,
      });
    });
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const excerpts: PursuitDocExcerpt[] = [];
  let total = 0;
  for (const s of scored) {
    if (excerpts.length >= MAX_EXCERPTS || total + s.text.length > MAX_TOTAL_CHARS) break;
    const { score: _s, order: _o, ...ex } = s;
    excerpts.push(ex);
    total += s.text.length;
  }
  return { excerpts, terms, truncated: scored.length > excerpts.length };
}
