-- DIBBS map coverage: persist derived lat/lng so open DLA bids can be VIEWPORT-queried
-- in SQL (bbox filter BEFORE the limit), exactly like sam_opportunities.
--
-- WHY: dibbs_rfqs had no map_lat/map_lng, so the open-map route fetched a GLOBAL
-- top-400 (deadline-sorted) then JS-filtered to the viewport — the rank-then-filter bug.
-- Zooming into a DLA center (Columbus, Philadelphia, Richmond) showed only whichever of
-- that national 400 happened to fall in-view, not the thousands of open bids actually
-- there. Customers need EVERY open bid in a view to find + bid. Persisting the coords
-- (derived deterministically from the solicitation's DoDAAC prefix via
-- src/data/dla-dodaac-locations.ts + a stable per-sol jitter) lets the route bbox-filter
-- in SQL and inherit SAM's clustering.
--
-- Backfill: scripts/backfill-dibbs-latlng.ts (idempotent, no API calls — pure lookup).
-- New rows get stamped by the sync going forward. NULL lat = DoDAAC not yet mapped
-- (an honest gap, surfaced by the sync's unmapped-DoDAAC warning), never a fake pin.
--
-- Hand-run in the Supabase SQL editor (no in-app DDL). Idempotent — safe to re-run.

ALTER TABLE public.dibbs_rfqs
  ADD COLUMN IF NOT EXISTS map_lat double precision,
  ADD COLUMN IF NOT EXISTS map_lng double precision,
  ADD COLUMN IF NOT EXISTS map_office text,   -- the DLA center name (card agency)
  ADD COLUMN IF NOT EXISTS map_loc text;      -- "City, ST" for the card

-- Composite index for the viewport query: open bids (return_by_date) that have coords,
-- filtered by a lat/lng bbox. Mirrors how sam_opportunities is queried.
CREATE INDEX IF NOT EXISTS dibbs_rfqs_map_bbox_idx
  ON public.dibbs_rfqs (return_by_date, map_lat, map_lng)
  WHERE map_lat IS NOT NULL;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'dibbs_rfqs' AND column_name IN ('map_lat','map_lng','map_office','map_loc');
--   SELECT indexname FROM pg_indexes WHERE tablename = 'dibbs_rfqs' AND indexname = 'dibbs_rfqs_map_bbox_idx';
