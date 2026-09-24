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

-- 2b · Durable progress of an interval that could not be processed in one run (> 20 keyset pages). Holds the
--      fixed snapshot, one (created_at, id) keyset cursor per segment, a running count and 3 evidence ids. The
--      watermark moves only when every segment is done. Bounded size; never a list of Forecasts.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_pending JSONB;

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

-- 6 · BACKFILL SAFETY GUARD. Creating a row stamps created_at = now(), which is what makes a Forecast "new".
--     While a publisher's floor is ACTIVE, only the declared DAILY SYNC may create rows for it:
--       PostgREST header  x-forecast-writer: daily_sync   (src/lib/forecasts/writer.ts forecastWriterClient)
--       or, in SQL,       SET LOCAL app.forecast_writer = 'daily_sync'
--     Any other writer (a historical import, a backfill script, psql) is refused until the publisher is suspended
--     (scripts/forecast-publisher-floor.ts --suspend / runPublisherBackfill). Upserts that only UPDATE an existing
--     (source_agency, external_id) are never refused — they cannot create a new created_at.
CREATE OR REPLACE FUNCTION agency_forecasts_floor_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  floor_state TEXT;
  writer      TEXT;
  hdrs        TEXT;
BEGIN
  SELECT state INTO floor_state FROM forecast_publisher_alert_floor WHERE source_agency = NEW.source_agency;
  IF floor_state IS NULL OR floor_state = 'suspended' THEN
    RETURN NEW;   -- no floor (not alertable) or suspended (a sanctioned load): nothing here can become an alert
  END IF;
  IF EXISTS (SELECT 1 FROM agency_forecasts WHERE source_agency = NEW.source_agency AND external_id = NEW.external_id) THEN
    RETURN NEW;   -- the ON CONFLICT path of an upsert: an update, created_at is kept
  END IF;
  writer := NULLIF(current_setting('app.forecast_writer', true), '');
  IF writer IS NULL THEN
    hdrs := NULLIF(current_setting('request.headers', true), '');
    IF hdrs IS NOT NULL THEN
      writer := hdrs::json ->> 'x-forecast-writer';
    END IF;
  END IF;
  IF writer = 'daily_sync' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = format('agency_forecasts: refusing to create %s/%s while the %s alert floor is ACTIVE (writer=%s).',
                     NEW.source_agency, NEW.external_id, NEW.source_agency, COALESCE(writer, 'undeclared')),
    HINT = 'Historical/bulk loads must suspend the publisher first: scripts/forecast-publisher-floor.ts --suspend, load, reconcile, --activate (or runPublisherBackfill).';
END
$$;

DROP TRIGGER IF EXISTS agency_forecasts_floor_guard ON agency_forecasts;
CREATE TRIGGER agency_forecasts_floor_guard
  BEFORE INSERT ON agency_forecasts
  FOR EACH ROW EXECUTE FUNCTION agency_forecasts_floor_guard();

