-- Shared compliance-matrix cache (Eric: scaling — the matrix for a SAM notice is
-- IDENTICAL for every user bidding it; extract once, serve all from cache. The
-- single biggest token-reduction lever for proposals at 50K users).
--
-- Keyed by a content hash (notice_id + the doc set's text signature) so the
-- cache invalidates automatically when an amendment lands and the docs change.
-- PUBLIC SAM notices only — a user's own uploaded docs are NOT shared (privacy).
--
-- Hand-run in the Supabase SQL editor, then NOTIFY pgrst.

CREATE TABLE IF NOT EXISTS compliance_matrix_cache (
  content_hash   TEXT PRIMARY KEY,       -- sha256(notice_id + doc text signature)
  notice_id      TEXT,
  requirements   JSONB NOT NULL,         -- the extracted + normalized requirements
  doc_sources    JSONB,                  -- which docs contributed (base/amendments/Q&A)
  req_count      INT,
  model          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  hits           INT DEFAULT 0           -- how many users served from this cache
);

CREATE INDEX IF NOT EXISTS idx_compliance_cache_notice ON compliance_matrix_cache (notice_id);

NOTIFY pgrst, 'reload schema';
