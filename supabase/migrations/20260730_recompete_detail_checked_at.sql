-- MINDY-007 remainder backfill: resumable stamp column for
-- scripts/backfill-recompete-detail.ts.
--
-- The backfill fills recompete_opportunities.psc_code / psc_description / description
-- from USASpending's award-DETAIL endpoint (the search endpoint the sync uses returns
-- them NULL). detail_checked_at lets the runner skip already-processed rows and resume
-- after an interruption: NULL = not yet fetched; a timestamp = done (stamped whether or
-- not the endpoint had data, so a genuine-empty award isn't re-fetched forever).
--
-- This DB has no in-app DDL — run this by hand in the Supabase SQL editor, confirm
-- "Success. No rows returned", then verify the column exists before the --go run.
-- Idempotent (IF NOT EXISTS guards) — safe to re-run.

ALTER TABLE public.recompete_opportunities
  ADD COLUMN IF NOT EXISTS detail_checked_at timestamptz;

-- Partial index so the runner's "WHERE detail_checked_at IS NULL" work-queue scan stays
-- cheap across ~132k rows as the backfill drains it.
CREATE INDEX IF NOT EXISTS recompete_opportunities_detail_unchecked_idx
  ON public.recompete_opportunities (detail_checked_at)
  WHERE detail_checked_at IS NULL;

-- Verify (should return the column + the index):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'recompete_opportunities' AND column_name = 'detail_checked_at';
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'recompete_opportunities'
--       AND indexname = 'recompete_opportunities_detail_unchecked_idx';
