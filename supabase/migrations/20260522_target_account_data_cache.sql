-- Target Market Research data cache
--
-- Caches the merged USAspending + SAM + pain points + events response
-- per (naics, business_type) combination. Per the Target Market
-- Research roadmap (tasks/target-market-research-roadmap.md), this
-- surface's job is to return all 60-100 offices for a NAICS so the
-- user can plan their BD outreach from real data.
--
-- Vocabulary note: the table name (agency_target_data_cache) is
-- an internal DB identifier — fine to keep. The user-facing
-- product surface is "Target Market Research", not "Target Account
-- List" / "TAL" — per the project vocabulary rule.
--
-- The underlying data sources only refresh daily (USASpending) or
-- daily-ish (sam_opportunities, sam_events), so caching this merge
-- for 24h is safe AND turns a multi-second compute into a 50ms
-- lookup for repeat visits.
--
-- Cache key strategy: (naics, business_type, veteran_status). State
-- is intentionally NOT part of the key because we filter in the
-- UI layer — the underlying agency-set is national.

CREATE TABLE IF NOT EXISTS agency_target_data_cache (
  -- Composite key
  naics_code TEXT NOT NULL,
  business_type TEXT DEFAULT '',         -- 'Women Owned' / '8(a) Certified' / etc
  veteran_status TEXT DEFAULT '',        -- 'SDVOSB' / 'VOSB' / 'Not Applicable'

  -- Cached merged payload
  agencies JSONB NOT NULL,               -- TargetAccountRow[]
  total_count INT NOT NULL DEFAULT 0,
  total_spending NUMERIC NOT NULL DEFAULT 0,
  sat_summary JSONB,                     -- { totalSATSpending, satFriendlyAgencies, etc }

  -- Observability
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generation_ms INT,                     -- how long the merge took
  source_versions JSONB,                 -- { find_agencies_ms, pain_points_ms, events_ms, opps_ms }

  PRIMARY KEY (naics_code, business_type, veteran_status)
);

-- Fast TTL eviction lookup: "delete rows older than 24h"
CREATE INDEX IF NOT EXISTS idx_agency_target_data_generated_at
  ON agency_target_data_cache (generated_at);

COMMENT ON TABLE agency_target_data_cache IS
  'Cache for /api/app/target-market-research merged response (USASpending + SAM + pain points + events). 24h TTL. Keyed by (naics, business_type, veteran_status).';

NOTIFY pgrst, 'reload schema';
