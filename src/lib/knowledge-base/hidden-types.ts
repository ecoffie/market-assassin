/**
 * Knowledge Base document types customers can neither browse nor open (Eric, 2026-11-27: hide podcast insights).
 * Hidden, not deleted: the rows stay in mindy_rag_documents; the list, facets, type filter and the single-document
 * route all refuse these types.
 */
export const HIDDEN_KB_DOC_TYPES: readonly string[] = ['podcast_interview'];

export function isHiddenKbDoc(doc: { doc_type?: string | null; source_path?: string | null }): boolean {
  if (doc.doc_type && HIDDEN_KB_DOC_TYPES.includes(doc.doc_type)) return true;
  // Podcast episodes are also recognisable by their source, whatever their doc_type.
  return typeof doc.source_path === 'string' && doc.source_path.startsWith('libsyn:');
}
