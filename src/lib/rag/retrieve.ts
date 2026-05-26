/**
 * Mindy RAG retrieval helper.
 *
 * Hides which retrieval signal we rank on behind a stable interface:
 *   retrieveRagContext({ query, filters, opts })
 *
 * Today: Postgres FTS (ts_rank) over mindy_rag_chunks.
 * Tomorrow (week 2-ish): pgvector cosine-similarity over an embedding
 *   column added to the same table. Callers don't change.
 *
 * Built 2026-05-26 to power Proposal Assist drafts with Eric Coffie's
 * 8-year teaching corpus (576 indexed documents, ~thousands of chunks).
 *
 * Design notes:
 *   - We rank at chunk level, not doc level, so long docs don't drown
 *     short tight ones.
 *   - We cap total chars returned (default 6000) so the prompt stays
 *     under model limits even if many strong chunks match.
 *   - We dedupe by document_id so the prompt isn't 5 chunks from the
 *     same file — we want breadth of source material.
 *   - We return source attribution (title, folder, doc_type) so the
 *     prompt can tell the model 'from Eric's <X> teaching'.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export interface RagChunkResult {
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  doc_title: string | null;
  doc_type: string | null;
  doc_top_level_folder: string | null;
  source_path: string | null;
  rank: number;
}

export interface RetrieveOptions {
  /** Comma-separated user query — keywords, RFP excerpt, section topic. */
  query: string;
  /** Optional doc_type filter (e.g. ['cap_statement', 'proposal_template']) */
  docTypes?: string[];
  /** Hard top-N chunks returned (default 8) */
  limit?: number;
  /** Total char budget for ALL returned chunk_text concatenated (default 6000) */
  maxChars?: number;
  /** Max chunks per source document (default 2) — favors breadth */
  maxPerDoc?: number;
}

/**
 * Retrieve teaching-corpus chunks relevant to a query.
 *
 * Calls Postgres get_rag_chunks(q, doc_types_filter, limit_n) RPC
 * which uses ts_rank_cd with per-doc-type boost coefficients to
 * favor cap_statement / proposal_template / past_performance over
 * generic content. Meta-docs (CONTENT-MAPPING, BENCHMARK, etc.) are
 * excluded at the SQL level.
 *
 * Returns a list of RagChunkResult capped at `limit`, `maxChars`,
 * and `maxPerDoc`. Empty array if no signal or query produces no
 * valid tokens.
 */
export async function retrieveRagContext(opts: RetrieveOptions): Promise<RagChunkResult[]> {
  const {
    query,
    docTypes,
    limit = 8,
    maxChars = 6000,
    maxPerDoc = 2,
  } = opts;

  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const supabase = getSupabase();
  // Pull a larger candidate pool than `limit` so per-doc dedup still
  // returns `limit` chunks. Cap at 5x limit or 50, whichever is smaller.
  const candidatePool = Math.min(limit * 5, 50);

  const { data, error } = await supabase.rpc('get_rag_chunks', {
    q: trimmed,
    doc_types_filter: docTypes && docTypes.length > 0 ? docTypes : null,
    limit_n: candidatePool,
  });

  if (error) {
    console.error('[RAG] retrieve failed:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // RPC already returns sorted by rank desc. Just dedup per-doc + cap chars.
  const out: RagChunkResult[] = [];
  const perDocCount = new Map<string, number>();
  let totalChars = 0;

  for (const row of data) {
    if (out.length >= limit) break;
    const docCount = perDocCount.get(row.document_id) || 0;
    if (docCount >= maxPerDoc) continue;
    const chunkLen = (row.chunk_text || '').length;
    if (totalChars + chunkLen > maxChars && out.length > 0) continue;
    out.push({
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      chunk_text: row.chunk_text,
      doc_title: row.doc_title,
      doc_type: row.doc_type,
      doc_top_level_folder: row.doc_top_level_folder,
      source_path: row.source_path,
      rank: row.rank,
    });
    perDocCount.set(row.document_id, docCount + 1);
    totalChars += chunkLen;
  }

  return out;
}

/**
 * Format retrieved chunks for injection into an AI prompt.
 *
 * Each chunk is wrapped with a source tag so the model knows where
 * the example came from. Caller is responsible for prefixing this
 * with a verbal frame like 'Use these as STYLE references, do not
 * copy verbatim'.
 */
export function formatChunksForPrompt(chunks: RagChunkResult[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map((c, i) => {
      const label = c.doc_title || c.source_path || `Source ${i + 1}`;
      const type = c.doc_type ? ` [${c.doc_type}]` : '';
      return `--- Example ${i + 1}: ${label}${type} ---\n${c.chunk_text.trim()}`;
    })
    .join('\n\n');
}
