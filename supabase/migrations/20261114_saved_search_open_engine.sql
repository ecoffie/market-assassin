-- Saved-search Open engine state (Agent 3 alert parity, 2026-11-14).
--
-- Records which Open evaluator ('legacy' | 'canonical') last wrote saved_searches.last_seen_notice_ids.
-- The alert cron re-baselines (stores current matches as seen, sends nothing) whenever the engine that
-- evaluates a search differs from the one that wrote its seen set, in EITHER direction. Without this, the
-- first run after the switch would email every canonical match the legacy engine never stored (up to the
-- 200-row window, notices up to 30 days old) as "new" — and a rollback would email the legacy set.
--
-- Additive + nullable. NULL = "only ever evaluated by legacy" (every row today). No backfill: the cron
-- stamps the column on its next successful write for each search. Idempotent.
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS open_engine text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_searches_open_engine_check'
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_open_engine_check
      CHECK (open_engine IS NULL OR open_engine IN ('legacy', 'canonical'));
  END IF;
END $$;

COMMENT ON COLUMN public.saved_searches.open_engine IS
  'Open evaluator (legacy|canonical) that last wrote last_seen_notice_ids. NULL = legacy. Engine change => re-baseline, no send.';
