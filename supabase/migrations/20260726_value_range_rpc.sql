-- Value-range RPC: compute the 10th/50th/90th percentile of real award amounts for a NAICS
-- (+ optional agency) from the cached recompete_opportunities table (143K USASpending awards).
-- This replaces the live USASpending API call (rate-limited, slow) with one instant DB query.
--
-- Outliers: cap at $500M to drop IDIQ ceilings / governmentwide-vehicle values (a $50B ceiling is
-- not a single opportunity's worth). total_obligation is the amount field. NAICS matched exactly on
-- 6-digit, or prefix for a shorter code. Returns null-ish (n=0) when too few comparables.
-- Drop the earlier 2-arg version (10-90 band) so only the tighter 3-arg one remains.
DROP FUNCTION IF EXISTS opp_value_range(text, text);

-- Band = 25th–75th percentile (the middle 50% of contracts) for a TIGHTER, more useful range —
-- the 10–90 band was honest but millions-wide. Optionally conditions on SUB-agency (the specific
-- buying command clusters tighter than the whole department). p_sub is tried first by the caller,
-- then it falls back to agency, then NAICS-only.
CREATE OR REPLACE FUNCTION opp_value_range(p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL)
RETURNS TABLE (n bigint, p10 numeric, p50 numeric, p90 numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint AS n,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY total_obligation) AS p10,  -- 25th (kept col name p10 for API compat)
    percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation) AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY total_obligation) AS p90   -- 75th
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub);
$$;

GRANT EXECUTE ON FUNCTION opp_value_range(text, text, text) TO service_role;
