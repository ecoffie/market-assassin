-- Watchlist History Pipeline (#96) — one daily snapshot per saved search so the Watchlist and
-- Reports dashboards can show REAL trends (deltas, sparklines, market movement, "what changed
-- since you last looked") instead of the deferred/omitted widgets. Nothing here is fabricated:
-- each row is a point-in-time reading of that saved search's live matched-opportunity set,
-- computed by /api/cron/snapshot-watchlist using the SAME parseMapFilters/applyMapFilters engine
-- the alert cron + the watchlist-brief endpoint use (so it can never drift from the live figures).
--
-- Idempotent: (saved_search_id, snapshot_date) is UNIQUE → re-running a day upserts, never dupes.

CREATE TABLE IF NOT EXISTS daily_saved_search_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_search_id     UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  user_email          TEXT NOT NULL,                          -- denormalized for per-user queries without a join
  snapshot_date       DATE NOT NULL,                          -- the UTC day this reading is for
  matched_count       INTEGER NOT NULL DEFAULT 0,             -- live matches for the filter set that day (capped-flag in meta)
  new_count           INTEGER NOT NULL DEFAULT 0,             -- matches not in last_seen at snapshot time (same rule as the badge)
  market_value        BIGINT   NOT NULL DEFAULT 0,            -- Σ intel_value_range.median over matches (null medians SKIPPED, never $0)
  agency_count        INTEGER NOT NULL DEFAULT 0,             -- distinct buying agencies (sub_tier||department) among matches
  state_distribution  JSONB    NOT NULL DEFAULT '{}'::jsonb,  -- { "VA": <$ by place-of-performance>, ... } (null medians skipped)
  dna_counts          JSONB    NOT NULL DEFAULT '{}'::jsonb,  -- { "repeat_buyer": n, "sb_friendly": n, ... } from opportunity_dna_keys
  capped              BOOLEAN  NOT NULL DEFAULT FALSE,         -- TRUE when the scan hit its row cap (figures are a FLOOR, not exact)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_daily_saved_search_snapshot UNIQUE (saved_search_id, snapshot_date)
);

-- Per-search time series (the sparkline / delta reads): WHERE saved_search_id = ? ORDER BY snapshot_date.
CREATE INDEX IF NOT EXISTS idx_dsss_search_date ON daily_saved_search_snapshots(saved_search_id, snapshot_date DESC);
-- Per-user rollups (a whole Watchlist's movement in one day).
CREATE INDEX IF NOT EXISTS idx_dsss_user_date   ON daily_saved_search_snapshots(user_email, snapshot_date DESC);

-- RLS: service-role only (all access is via authed API routes using the service key), same as saved_searches.
ALTER TABLE daily_saved_search_snapshots ENABLE ROW LEVEL SECURITY;
