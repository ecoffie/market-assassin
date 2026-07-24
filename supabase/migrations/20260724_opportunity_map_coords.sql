-- Opportunity Map coords (2026-07-24) — precomputed pin coordinates so the map EXPLORER
-- can query by viewport (bbox) instead of geocoding ~11k rows in memory on every pan.
-- Values are derived by the SAME geocode() chain the map already uses:
--   place-of-performance city → pop ZIP → buying-office ZIP → office city → state centroid.
-- Nullable on purpose: a notice we cannot place gets NO pin (honest — never dropped at 0,0).
-- Backfilled by /api/admin/backfill-map-coords; new rows are stamped at sync time.

ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS map_lat DOUBLE PRECISION;
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS map_lng DOUBLE PRECISION;

-- Composite index for viewport (bbox) range scans. The hot path is active biddable rows,
-- but keep it plain (not partial) so the archive/all-SAM view uses it too.
CREATE INDEX IF NOT EXISTS idx_sam_opps_map_coords ON sam_opportunities (map_lat, map_lng);
