-- Flexible-percentile version of opp_value_range for backtesting band widths (and future tuning).
-- Returns any low/mid/high percentile so we can measure the coverage-vs-tightness tradeoff.
CREATE OR REPLACE FUNCTION opp_value_pctl(p_naics text, p_agency text, p_lo numeric, p_mid numeric, p_hi numeric)
RETURNS TABLE (n bigint, lo numeric, mid numeric, hi numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint,
    percentile_cont(p_lo)  WITHIN GROUP (ORDER BY total_obligation),
    percentile_cont(p_mid) WITHIN GROUP (ORDER BY total_obligation),
    percentile_cont(p_hi)  WITHIN GROUP (ORDER BY total_obligation)
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency);
$$;
GRANT EXECUTE ON FUNCTION opp_value_pctl(text, text, numeric, numeric, numeric) TO service_role;
