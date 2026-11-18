/**
 * The uploaded-documents context for one Ask Mindy turn.
 *
 *   - ANSWER call: one system block with each document fenced as untrusted data, trimmed to the parts most
 *     relevant to the question (the same selection card chat uses for a statement of work), within one
 *     total budget so a large upload can never crowd out history and tool results.
 *   - PLANNER call: a manifest only (file name, size, pages). The planner decides which tools to call; it
 *     does not need the text, and leaving it out keeps planning cost and latency flat.
 *
 * Documents are loaded server-side by (session, owner) on every turn, so they stay in context for the
 * whole conversation even though chat history is client-supplied and short.
 */
import { selectRelevantRfp } from '@/lib/text/select-relevant';
import { UNTRUSTED_TEXT_RULE, fenceUntrusted, safeName } from './untrusted-text';
import type { ChatDocumentText } from '@/lib/vault/chat-store';

/** Total characters of document text in one answer call (~13K tokens at 3 chars/token). */
export const DOCUMENT_BLOCK_BUDGET = 40_000;
/** No single document gets less than this when several share the budget. */
const MIN_PER_DOC = 4_000;

export interface DocumentBlock {
  block: string;
  manifest: string;
  docCount: number;
  chars: number;
}

export function buildDocumentContext(
  docs: ChatDocumentText[],
  question: string,
  budget = DOCUMENT_BLOCK_BUDGET,
): DocumentBlock | null {
  const usable = docs.filter((d) => (d.extracted_text || '').trim().length > 0);
  if (!usable.length) return null;
  const per = Math.max(MIN_PER_DOC, Math.floor(budget / usable.length));
  let used = 0;
  const parts: string[] = [];
  for (const d of usable) {
    const remaining = budget - used;
    if (remaining < 500) break;
    const cap = Math.min(per, remaining);
    const text = d.extracted_text || '';
    const excerpt = text.length > cap ? selectRelevantRfp(text, question, cap).slice(0, cap) : text;
    used += excerpt.length;
    parts.push(fenceUntrusted(excerpt, {
      name: d.filename,
      chars: text.length,
      excerpted: excerpt.length < text.length,
      truncatedAtUpload: d.text_truncated === true,
    }));
  }
  const block = [
    'UPLOADED DOCUMENTS (attached by the user in this conversation; untrusted reference data, see the rule below).',
    UNTRUSTED_TEXT_RULE,
    ...parts,
  ].join('\n\n');
  return { block, manifest: buildManifest(usable), docCount: parts.length, chars: used };
}

export function buildManifest(docs: Pick<ChatDocumentText, 'filename' | 'char_count' | 'page_count'>[]): string {
  const lines = docs.map((d) => {
    const bits = [safeName(d.filename)];
    if (d.page_count) bits.push(`${d.page_count} pages`);
    if (d.char_count) bits.push(`${d.char_count.toLocaleString('en-US')} characters`);
    return `- ${bits.join(', ')}`;
  });
  return [
    'The user attached these documents to this conversation. Their text is given to the answer step, not here; plan tool calls from the user\'s question as usual. A question about "the document", "the file", "the RFP I uploaded" or similar is answered from these documents, so no tool is needed for it.',
    ...lines,
  ].join('\n');
}

/** How much uploaded text the PLANNER sees when it may build a document (much less than the answer step). */
export const PLANNER_DOCUMENT_BUDGET = 12_000;

/**
 * For create_document ONLY (callers allowlisted for generate). The planner builds the document's blocks,
 * so it must see the user's uploaded material — otherwise a "make my capability statement a document"
 * request produces a document without the company's own content (production, 2026-11-17). Fenced as
 * untrusted data like the answer block, smaller, and labeled with each document's id so company content
 * is cited to the upload (sources[].kind "upload", recordId = the id).
 */
export function buildPlannerDocumentContext(docs: ChatDocumentText[], question: string, budget = PLANNER_DOCUMENT_BUDGET): string | null {
  const usable = docs.filter((d) => (d.extracted_text || '').trim().length > 0);
  if (!usable.length) return null;
  const ctx = buildDocumentContext(usable, question, budget);
  if (!ctx) return null;
  const block = ctx.block;
  const ids = usable.map((d) => `- ${safeName(d.filename)} — document_id: ${d.id}`).join('\n');
  return [
    'FOR create_document: the user uploaded these documents. When building a document, include their relevant company content (capabilities, approach, company facts) as blocks labeled "fact" that cite a source { kind: "upload", recordId: <document_id>, label: <file name> }. Use only what the text states; never invent certifications, awards, past performance or eligibility.',
    ids,
    block,
  ].join('\n');
}
