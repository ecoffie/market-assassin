-- Mindy RAG Library — chunk storage + FTS
--
-- Sidecar to mindy_rag_documents. We chunk each document's full_text
-- into ~500-word passages with overlap, then rank at CHUNK level
-- instead of whole-document level. This fixes two things:
--   1. Long docs (286 misc, some 50k chars) win every whole-doc FTS
--      because they have more matching tokens — chunk ranking
--      normalizes by passage size.
--   2. We can pull a tight, on-point passage into the proposal-draft
--      prompt instead of dumping a whole doc.
--
-- Architecture is deliberately FTS-first but embeddings-ready:
-- when we add pgvector later, we add an embedding vector(1536)
-- column to this same table. The retrieveRagContext() helper hides
-- which signal we rank on, so swap-in is one-file.

CREATE TABLE IF NOT EXISTS mindy_rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES mindy_rag_documents(id) ON DELETE CASCADE,

  -- Ordering within the source doc (0-indexed)
  chunk_index INT NOT NULL,

  -- The chunk text + denormalized doc context for cheaper retrieval
  -- (avoids a JOIN on every query)
  chunk_text TEXT NOT NULL,
  doc_type TEXT,
  doc_title TEXT,
  doc_top_level_folder TEXT,
  source_path TEXT,

  -- Postgres FTS — auto-maintained from chunk_text
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,

  -- Reserved for future pgvector upgrade (NULL until embedding pass runs)
  -- embedding vector(1536),

  -- Sizing for ranking tiebreakers
  word_count INT,
  char_count INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_fts ON mindy_rag_chunks USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_doctype ON mindy_rag_chunks(doc_type);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_docid ON mindy_rag_chunks(document_id);

COMMENT ON TABLE mindy_rag_chunks IS
  'Mindy RAG retrieval index. ~500-word passages from mindy_rag_documents.full_text with Postgres FTS. retrieveRagContext() ranks here. Future pgvector upgrade just adds embedding column.';

NOTIFY pgrst, 'reload schema';
