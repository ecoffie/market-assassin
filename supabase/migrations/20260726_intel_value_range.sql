-- Grounded $ value range for the opportunity card ("price" hook).
-- Stores { low, median, high, label, source } derived from predecessor value OR comparable-award
-- median/IQR (USASpending). Precomputed by buildOppIntel + the precompute cron/backfill; read
-- instantly by the opportunity-detail API. jsonb (nullable) — null when no grounded range exists.
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS intel_value_range JSONB;
