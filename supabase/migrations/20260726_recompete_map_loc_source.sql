-- Recompete real task-order city backfill (2026-07-26) — marks WHERE a recompete
-- contract's map_lat/map_lng came from, so the map can tell a real city hit apart
-- from the honest state-centroid fallback, and so the backfill script (
-- scripts/backfill-recompete-map-latlng.ts) is resumable (skip rows already stamped).
--
-- Measured: 0 of 134,162 recompete_opportunities rows carry a place_of_performance_city
-- (SAM/USASpending's contract-level record never had one) — every stored map_lat/map_lng
-- is a pure STATE-CENTROID + jitter. The backfill recovers a real city from each
-- contract's TASK ORDERS (src/lib/recompete/task-orders.ts getTaskOrders(), which DO carry
-- a real pop_city ~97% of the time), scoped by the PROVEN-SAFE join key
-- (recipient_uei + piid/parent_piid — see that file's header comment on the join-key trap).
--
-- 'task_order_city'  = a real city recovered from the contract's task-order stream.
-- 'state_approx'      = no task orders had a usable city — left at the honest state-centroid
--                        (NEVER fabricated), so the UI can keep showing "(approximate)".
-- NULL                = not yet processed by the backfill (the resumable cursor).

ALTER TABLE recompete_opportunities ADD COLUMN IF NOT EXISTS map_loc_source TEXT;

-- Partial index so "WHERE map_loc_source IS NULL" (the resumable work queue) stays cheap
-- even after most of the table is stamped.
CREATE INDEX IF NOT EXISTS idx_recompete_map_loc_source_null
  ON recompete_opportunities (contract_id)
  WHERE map_loc_source IS NULL;

COMMENT ON COLUMN recompete_opportunities.map_loc_source IS
  'Provenance of map_lat/map_lng: task_order_city (real PoP city recovered from task orders) or state_approx (honest state-centroid fallback, no task-order city found). NULL = not yet backfilled.';
