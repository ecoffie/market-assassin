-- Set-aside enrichment for recompete rows (scope: tasks/setaside-enrichment-scope-2026-07-29.md).
-- recompete_opportunities.set_aside_type is NULL on all 132K live rows (the USASpending recompete sync
-- omits it). This ADDS an enriched column backfilled from BigQuery awards.set_aside via PIID — leaving
-- the raw sync field untouched. Read side NEVER infers: NULL set_aside_enriched → "unknown", exactly
-- as today. ~11% of rows gain a real set-aside; a larger slice gain a confirmed "Full & Open"; the
-- rest stay honest-null. No fabrication.
ALTER TABLE recompete_opportunities
  ADD COLUMN IF NOT EXISTS set_aside_enriched   text,          -- '8(a)'|'SDVOSB'|'WOSB'|'EDWOSB'|'HUBZone'|'SB-Total'|'Full & Open'|NULL
  ADD COLUMN IF NOT EXISTS set_aside_source     text,          -- 'bq_awards' | NULL (never guessed)
  ADD COLUMN IF NOT EXISTS set_aside_checked_at timestamptz;   -- resumability stamp for the backfill runner

-- Speeds the resumable backfill's "not yet checked" scan.
CREATE INDEX IF NOT EXISTS idx_recompete_setaside_unchecked
  ON recompete_opportunities (set_aside_checked_at)
  WHERE quality_flag IS NULL;
