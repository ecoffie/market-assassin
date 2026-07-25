-- Precompute + store per-opportunity intelligence for the map detail drawer, so the
-- drawer reads instantly instead of running live tools on every click. Slow-changing
-- data (predecessor history, agency intel, GSA pricing) → perfect for precompute.
-- Mirrors the existing sow_text / seo_summary / map_lat precompute pattern. Idempotent.

ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS intel_predecessor JSONB;
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS intel_agency      JSONB;
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS intel_pricing     JSONB;
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS intel_computed_at TIMESTAMPTZ;

-- Drain cursor: least-recently-computed active opps first (NULLs first = never computed).
CREATE INDEX IF NOT EXISTS idx_sam_intel_computed_at ON sam_opportunities (intel_computed_at NULLS FIRST)
  WHERE active = true;
