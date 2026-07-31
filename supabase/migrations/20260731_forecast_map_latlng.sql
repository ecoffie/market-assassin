-- Forecast map coverage: persist derived lat/lng on agency_forecasts so the Forecasts layer
-- of the Opportunities map can be VIEWPORT-queried in SQL (bbox before limit) like SAM/DIBBS.
--
-- WHY: agency_forecasts has pop_state (97% filled) + pop_city (~44%), but no map coords. Deriving
-- them at read time per request is slow; persist once (via the shared geocode(): city → state
-- centroid fallback, same chain SAM opps use) so the forecast-map route bbox-filters in SQL.
-- Forecast = the "coming work" horizon (violet pin), the third time-horizon on the Opportunities
-- map alongside Open (green) and Recompete (amber). (Eric 2026-07-30, the two-map model.)
--
-- Backfill: scripts/backfill-forecast-latlng.ts (idempotent, no API calls — pure geocode lookup).
-- New rows get stamped by the forecast sync/import going forward. NULL lat = no resolvable state
-- (an honest gap; the row just won't pin), never a fake coordinate.
--
-- Hand-run in the Supabase SQL editor (no in-app DDL). Idempotent — safe to re-run.

ALTER TABLE public.agency_forecasts
  ADD COLUMN IF NOT EXISTS map_lat double precision,
  ADD COLUMN IF NOT EXISTS map_lng double precision,
  ADD COLUMN IF NOT EXISTS map_loc_source text;   -- 'city' (precise) | 'state' (centroid fallback)

-- Composite index for the viewport query: forecasts with coords, filtered by a lat/lng bbox.
-- Mirrors how sam_opportunities / dibbs_rfqs are queried on the map.
CREATE INDEX IF NOT EXISTS agency_forecasts_map_bbox_idx
  ON public.agency_forecasts (map_lat, map_lng)
  WHERE map_lat IS NOT NULL;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'agency_forecasts' AND column_name IN ('map_lat','map_lng','map_loc_source');
--   SELECT indexname FROM pg_indexes WHERE tablename = 'agency_forecasts' AND indexname = 'agency_forecasts_map_bbox_idx';
