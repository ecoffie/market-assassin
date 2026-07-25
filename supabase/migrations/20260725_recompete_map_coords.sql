-- Recompete map coords (2026-07-25) — pin coordinates for the Opportunity Map "Recompetes"
-- mode (Zillow-style dataset toggle). Derived by the SAME resolvePinCoord() the open-opps map
-- uses, from place_of_performance_* (the incumbent's work location). Nullable = no pin (honest).

ALTER TABLE recompete_opportunities ADD COLUMN IF NOT EXISTS map_lat DOUBLE PRECISION;
ALTER TABLE recompete_opportunities ADD COLUMN IF NOT EXISTS map_lng DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_recompete_map_coords ON recompete_opportunities (map_lat, map_lng);
