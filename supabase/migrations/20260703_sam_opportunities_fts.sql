-- ============================================================================
-- Full-text search index on sam_opportunities  (2026-07-03)
--
-- WHY: The keyword filter in applySamCacheFilters() used leading-wildcard
-- ILIKEs — `title.ilike.%kw%` / `description.ilike.%kw%`. A leading `%` cannot
-- use a btree index, so every keyword search SEQUENTIALLY SCANS the ~88k-row
-- sam_opportunities table. That query runs PER USER in daily-alerts (150/run ×
-- 4 runs/day) and again across the four daily snapshot crons + the notice
-- summary. Stacked on one morning, ~1,284 users each trigger multiple full
-- scans → memory pressure → thrash to disk → daily Burst Disk I/O exhausted →
-- "Failed to retrieve tables" / connection timeouts (Supabase support's
-- diagnosis, 2026-07-03).
--
-- FIX: a generated tsvector column (title + description) + a GIN index. The
-- code swaps the ILIKEs for a websearch/word full-text match against this
-- column (PostgREST `.wfts`), turning the seq-scan into an indexed lookup.
--
-- SAFETY / RUN NOTES:
--  * Adding a GENERATED column rewrites the table once (a few seconds on 88k
--    rows) and briefly locks it. Run during a quiet window. There is no data
--    change — only a derived column + index.
--  * CREATE INDEX CONCURRENTLY cannot run inside a transaction block. If the
--    Supabase SQL editor wraps this in a txn and the CONCURRENTLY line errors,
--    run the two statements SEPARATELY: the ALTER first, then the CREATE INDEX
--    CONCURRENTLY on its own.
--  * Idempotent: IF NOT EXISTS guards let you re-run safely.
-- ============================================================================

-- 1) Generated tsvector over the two searched fields. STORED = computed on
--    write, so reads are index-only and the column self-maintains on every
--    insert/update (no trigger to keep in sync).
ALTER TABLE public.sam_opportunities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(description, '')
    )
  ) STORED;

-- 2) GIN index for fast full-text matching. CONCURRENTLY avoids a long write
--    lock on the live table. (If your SQL editor errors on CONCURRENTLY inside
--    a transaction, drop the word CONCURRENTLY or run this line by itself.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS sam_opportunities_search_tsv_idx
  ON public.sam_opportunities
  USING GIN (search_tsv);

-- Verify (should return the column + the index):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'sam_opportunities' AND column_name = 'search_tsv';
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'sam_opportunities' AND indexname = 'sam_opportunities_search_tsv_idx';
