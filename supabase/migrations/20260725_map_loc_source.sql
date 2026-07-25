-- Opportunity Map location honesty (2026-07-25) — records WHERE a pin's coordinate came from:
--   'pop'    = the actual place of performance (a pop_* field matched, incl. overseas)
--   'office' = we fell back to the BUYING OFFICE because SAM omitted place-of-performance
--              (~64% of notices). Such a pin is the contracting office, NOT confirmed PoP.
-- The map labels and styles the two differently so an office-fallback pin isn't misread as
-- "the work happens here." Stamped by resolvePinCoord alongside map_lat/map_lng.

ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS map_loc_source TEXT;
