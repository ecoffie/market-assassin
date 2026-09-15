-- migrate:no-transaction
-- ── 3. Keyset support.
--
-- The backfill lane orders by (created_at, notice_id) ascending. sam_opportunities had no
-- created_at index at all (only posted_date DESC), so without this the drain degrades to a
-- full sort of 207,986 rows on every page. CONCURRENTLY so a live sync is not blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sam_opps_created_keyset
  ON sam_opportunities (created_at, notice_id);
