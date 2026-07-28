-- Zoomed-out map aggregation (Eric 2026-07-28).
-- When a map view holds more contracts than the pin cap (990), returning 1,000 raw pins is both an
-- illegible pile AND drops ~99% of results. Instead we return per-STATE counts (rendered as count
-- bubbles) so 100% of contracts are represented. This RPC does the GROUP BY server-side, applying
-- the SAME filters the pin query uses, so a bubble's count always reconciles with the header total.
--
-- Returns one row per place_of_performance_state IN the bbox (a NULL state_code row carries the
-- count of contracts with no mappable location — surfaced as an honest "location unknown" bucket,
-- never silently dropped). Centroid lat/lng are resolved app-side from STATE_CENTROIDS; the RPC
-- returns only state_code + cnt, keeping the geo table in one place.
--
-- All params are optional (NULL = no filter) and MIRROR the recompete-map route's applyFilters:
--   set_aside, agency (ilike), state (exact), sub_agency (ilike), min/max value, sap contract-type
--   bucket, likelihood, lead_max, and the Layer-1 "expiring today-or-later" default.
CREATE OR REPLACE FUNCTION recompete_map_state_counts(
  p_south      double precision,
  p_north      double precision,
  p_west       double precision,
  p_east       double precision,
  p_set_aside  text     DEFAULT NULL,
  p_agency     text     DEFAULT NULL,
  p_naics      text     DEFAULT NULL,
  p_state      text     DEFAULT NULL,
  p_sub_agency text     DEFAULT NULL,
  p_min_value  numeric  DEFAULT NULL,
  p_max_value  numeric  DEFAULT NULL,
  p_sap        text     DEFAULT NULL,   -- '' | 'friendly' (PO+BPA CALL) | 'gated' (DELIVERY ORDER)
  p_likelihood text     DEFAULT NULL,   -- '' | 'high'
  p_lead_max   int      DEFAULT NULL,   -- 6 | 12 | 18
  p_include_past boolean DEFAULT false  -- Layer-1: default excludes already-expired
)
RETURNS TABLE (state_code text, cnt bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT place_of_performance_state AS state_code, count(*) AS cnt
  FROM recompete_opportunities
  WHERE quality_flag IS NULL
    AND map_lat IS NOT NULL
    AND map_lat BETWEEN p_south AND p_north
    AND map_lng BETWEEN p_west  AND p_east
    AND (p_include_past OR period_of_performance_current_end >= (now() AT TIME ZONE 'utc')::date)
    AND (p_set_aside  IS NULL OR set_aside_type = p_set_aside)
    AND (p_agency     IS NULL OR awarding_agency ILIKE '%' || p_agency || '%')
    AND (p_naics      IS NULL OR naics_code = p_naics OR naics_code LIKE left(p_naics, 3) || '%')
    AND (p_state      IS NULL OR place_of_performance_state = p_state)
    AND (p_sub_agency IS NULL OR awarding_sub_agency ILIKE '%' || p_sub_agency || '%')
    AND (p_min_value  IS NULL OR potential_total_value >= p_min_value)
    AND (p_max_value  IS NULL OR potential_total_value <= p_max_value)
    AND (p_sap IS NULL OR p_sap = '' OR
         (p_sap = 'friendly' AND contract_type IN ('PURCHASE ORDER','BPA CALL')) OR
         (p_sap = 'gated'    AND contract_type = 'DELIVERY ORDER'))
    AND (p_likelihood IS NULL OR p_likelihood = '' OR recompete_likelihood = p_likelihood)
    AND (p_lead_max   IS NULL OR lead_time_months <= p_lead_max)
  GROUP BY place_of_performance_state
$$;

-- Service-role only (same posture as the table's RLS).
REVOKE ALL ON FUNCTION recompete_map_state_counts FROM public, anon, authenticated;
