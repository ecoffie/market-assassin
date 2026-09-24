-- Saved Search FORECAST newness = a created_at watermark (2026-09-24).
-- Record: tasks/saved-search-forecast-watermark-2026-09-24.md
--
-- Every object here is ADDITIVE and NULLABLE. The legacy Forecast engine reads none of them, and the
-- canonical engine only runs when SAVED_SEARCH_FORECAST_CANONICAL = 'true'. Idempotent.
--
-- A Forecast is new for a saved search iff it matches the canonical plan, its publisher is covered,
-- created_at ∈ (watermark, snapshot], and created_at > its publisher's alert floor.

-- 1 · Per-search watermark. NULL = never measured by the canonical engine → the next run baselines silently.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_seen_through TIMESTAMPTZ;

-- 2 · Per-requested-buyer catch-up boundaries for PARTIAL coverage. {"<saved buyer>": "<timestamptz>"}.
--     A buyer the plan cannot cover keeps the boundary it had when it went uncovered, so its Forecasts
--     stay discoverable once it becomes covered (no permanent blind spot). Bounded by the number of saved
--     buyers (≤ the agency multi-select), never by the number of Forecasts.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_gap_since JSONB;

-- 3 · Publisher alert floors. Key = agency_forecasts.source_agency — the canonical publisher code Discovery
--     resolves buyers to (resolveForecastAgencies().codes / child parentSourceAgency).
--     A publisher WITHOUT a row, or with state 'suspended', is NOT alertable (fail closed): a new publisher's
--     historical onboarding can never become user alerts by accident. Written only by the explicit floor path
--     (src/lib/forecasts/alert-floor.ts) — never by the daily sync.
CREATE TABLE IF NOT EXISTS forecast_publisher_alert_floor (
  source_agency    TEXT PRIMARY KEY,
  state            TEXT NOT NULL CHECK (state IN ('active', 'suspended')),
  alertable_after  TIMESTAMPTZ,              -- rows with created_at <= this are never "new"
  reason           TEXT NOT NULL,
  set_by           TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state = 'suspended' OR alertable_after IS NOT NULL)
);

-- Append-only history, so every floor move is attributable and reversible.
CREATE TABLE IF NOT EXISTS forecast_publisher_alert_floor_log (
  id                    BIGSERIAL PRIMARY KEY,
  source_agency         TEXT NOT NULL,
  prev_state            TEXT,
  prev_alertable_after  TIMESTAMPTZ,
  new_state             TEXT NOT NULL,
  new_alertable_after   TIMESTAMPTZ,
  reason                TEXT NOT NULL,
  set_by                TEXT NOT NULL,
  logged_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE forecast_publisher_alert_floor ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_publisher_alert_floor_log ENABLE ROW LEVEL SECURITY;

-- 4 · Snapshot time from the DATABASE clock (created_at is a DB default), lagged so rows written by a
--     transaction still in flight at snapshot time cannot fall between two runs: they land in the next
--     interval instead. One immutable value per evaluation.
CREATE OR REPLACE FUNCTION saved_search_forecast_snapshot()
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
AS $$ SELECT now() - interval '5 minutes' $$;

REVOKE ALL ON FUNCTION saved_search_forecast_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION saved_search_forecast_snapshot() TO service_role;

-- 5 · Candidate selection filters on created_at.
CREATE INDEX IF NOT EXISTS idx_agency_forecasts_created_at ON agency_forecasts (created_at);
