-- Value-range RPC: compute the 10th/50th/90th percentile of real award amounts for a NAICS
-- (+ optional agency) from the cached recompete_opportunities table (143K USASpending awards).
-- This replaces the live USASpending API call (rate-limited, slow) with one instant DB query.
--
-- Outliers: cap at $500M to drop IDIQ ceilings / governmentwide-vehicle values (a $50B ceiling is
-- not a single opportunity's worth). total_obligation is the amount field. NAICS matched exactly on
-- 6-digit, or prefix for a shorter code. Returns null-ish (n=0) when too few comparables.
CREATE OR REPLACE FUNCTION opp_value_range(p_naics text, p_agency text DEFAULT NULL)
RETURNS TABLE (n bigint, p10 numeric, p50 numeric, p90 numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint AS n,
    percentile_cont(0.10) WITHIN GROUP (ORDER BY total_obligation) AS p10,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation) AS p50,
    percentile_cont(0.90) WITHIN GROUP (ORDER BY total_obligation) AS p90
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency);
$$;

-- Callable by the service role (server-side only, like our other RPCs).
GRANT EXECUTE ON FUNCTION opp_value_range(text, text) TO service_role;
