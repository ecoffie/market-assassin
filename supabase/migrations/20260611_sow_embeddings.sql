-- SOW embedding corpus (#67 / semantic recompete match).
-- Stores OpenAI text-embedding-3-small vectors for cosine match at query time.
-- Hand-run in Supabase SQL editor (idempotent). Or GET /api/admin/apply-sow-embeddings-migration.

ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS sow_embedding   JSONB,
  ADD COLUMN IF NOT EXISTS sow_embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sam_sow_embed_todo
  ON sam_opportunities (sow_embedded_at NULLS FIRST)
  WHERE has_sow_doc = true AND sow_text IS NOT NULL;
