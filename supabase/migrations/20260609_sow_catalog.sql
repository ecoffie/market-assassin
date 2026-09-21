-- SOW/PWS catalog (#66) — Eric's "in-between" workaround.
-- Flag + cache the scope document on the ~38% of active opps that have one, so we
-- can (a) filter the feed to "has SOW/PWS" NOW and (b) build the affordable
-- embedding corpus for semantic "hidden work" search later (~12K not 33K).
--
-- Hand-run in Supabase SQL editor (this DB has no in-app DDL). Idempotent.

ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS has_sow_doc      BOOLEAN,                 -- null = not checked yet
  ADD COLUMN IF NOT EXISTS sow_doc_type     TEXT,                    -- sow | pws | soo | combined | specs
  ADD COLUMN IF NOT EXISTS sow_filename     TEXT,                    -- the detected scope doc's name
  ADD COLUMN IF NOT EXISTS sow_text         TEXT,                    -- extracted scope text (embedding corpus)
  ADD COLUMN IF NOT EXISTS sow_checked_at   TIMESTAMPTZ;             -- when the backfill last looked

-- Backfill cursor: least-recently-checked, attachment-bearing, active opps first.
-- Partial index keeps the cron's "next batch" query fast as the table grows.
CREATE INDEX IF NOT EXISTS idx_sam_sow_uncheck
  ON sam_opportunities (sow_checked_at NULLS FIRST)
  WHERE active = true AND attachments IS NOT NULL;

-- Feed filter: "show me opps with a real SOW/PWS" (the serious, evaluable ones).
CREATE INDEX IF NOT EXISTS idx_sam_has_sow
  ON sam_opportunities (has_sow_doc, sow_doc_type)
  WHERE has_sow_doc = true;
