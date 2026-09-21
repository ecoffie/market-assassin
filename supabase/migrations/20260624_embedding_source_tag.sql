-- Tag every SOW embedding by the text it was built from, so we keep the two
-- corpora straight (Eric, Jun 24 2026):
--   'sow'         — embedded from the full statement of work → high precision,
--                   drives hidden-match ALERTS (pool already filters has_sow_doc).
--   'description' — embedded from the notice summary → broad/lower precision,
--                   for DISCOVERY only, never alerts.
--   'none'        — checked, no embeddable text (the empty-array sentinel rows).
--   NULL          — not yet processed.

ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS embedding_source text;

-- Backfill existing REAL embeddings (1536-d). Everything embedded before the
-- description fallback shipped was SOW-based; tag by sow_text presence to be exact
-- (covers the handful of description rows from the new cron's first runs too).
UPDATE sam_opportunities
SET embedding_source = CASE WHEN sow_text IS NOT NULL THEN 'sow' ELSE 'description' END
WHERE embedding_source IS NULL
  AND sow_embedding IS NOT NULL
  AND jsonb_array_length(sow_embedding) = 1536;

-- Empty-array sentinels (skipped rows) → 'none'. Leave the sentinel in place so the
-- embed cron (which keys off sow_embedding IS NULL) does not re-process them.
UPDATE sam_opportunities
SET embedding_source = 'none'
WHERE embedding_source IS NULL
  AND sow_embedding IS NOT NULL
  AND jsonb_array_length(sow_embedding) = 0;

CREATE INDEX IF NOT EXISTS idx_sam_opps_embedding_source ON sam_opportunities (embedding_source);
