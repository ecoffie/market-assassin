-- pursuit_documents — auto-ingested SAM.gov attachments per pursuit
--
-- When a user clicks Track on an opportunity, the server fetches all
-- attached PDFs/DOCX from SAM.gov, uploads blobs to Supabase Storage
-- (bucket: 'pursuit-documents'), extracts text via pdf-parse/mammoth,
-- and writes a row here. Proposal Assist reads from this table when
-- a user opens it from a pursuit — no manual upload needed.
--
-- Why a separate table vs columns on user_pipeline:
--   - One pursuit can have N attachments (RFP, SOW, Q&A, amendments).
--     Columns would force serialization.
--   - Extracted text can be large (50K+ chars per doc). Don't bloat
--     the hot pipeline row that gets read constantly.
--   - Lets us delete/re-fetch individual docs (e.g., if SAM posts an
--     amendment) without touching the pursuit row.

CREATE TABLE IF NOT EXISTS pursuit_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  pipeline_id UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,

  -- SAM.gov identity
  sam_file_id TEXT NOT NULL,          -- The fileId from opportunities[].resources[].fileId
  sam_url TEXT,                       -- Direct SAM download URL (for re-fetch)
  notice_id TEXT,                     -- Convenience: SAM notice this came from

  -- File metadata
  filename TEXT NOT NULL,
  mime_type TEXT,                     -- application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, etc.
  size_bytes BIGINT,

  -- Storage
  storage_path TEXT,                  -- Path in Supabase Storage bucket (NULL if extraction-only)

  -- Extracted content (cached so Proposal Assist doesn't re-parse)
  extracted_text TEXT,                -- Full text, max ~50K chars (truncated past that)
  page_count INT,
  char_count INT,

  -- Processing state
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_at TIMESTAMPTZ,
  extraction_error TEXT,              -- If parse failed, why

  CONSTRAINT pursuit_documents_unique UNIQUE (pipeline_id, sam_file_id)
);

CREATE INDEX IF NOT EXISTS idx_pursuit_docs_pipeline
  ON pursuit_documents (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pursuit_docs_user
  ON pursuit_documents (user_email, downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pursuit_docs_notice
  ON pursuit_documents (notice_id);

COMMENT ON TABLE pursuit_documents IS
  'Auto-ingested SAM.gov attachments per pursuit. Powers Proposal Assist auto-load: user clicks Track on opp → server fetches docs → cached here → Proposal Assist reads on open. Eliminates the manual SAM download + upload friction.';

-- Add document status to user_pipeline so UI can show "Fetching docs…"
-- vs "X docs ready" vs "No docs found" badges on pursuit rows.
ALTER TABLE user_pipeline
  ADD COLUMN IF NOT EXISTS docs_status TEXT DEFAULT 'pending'
    CHECK (docs_status IN ('pending', 'fetching', 'ready', 'none', 'failed')),
  ADD COLUMN IF NOT EXISTS docs_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS docs_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN user_pipeline.docs_status IS
  'pending = saved but fetch not started; fetching = in flight; ready = N docs cached; none = SAM has no attachments; failed = error during fetch';

NOTIFY pgrst, 'reload schema';
