-- M-Estimate(TM) distribution chart — a small histogram of comparable-award amounts, alongside
-- the existing opp_value_range percentile RPC. Feeds the "where similar awards landed" bars in
-- the opportunity-map detail drawer. Same filter + same $1K-$500M outlier cap as opp_value_range
-- (recompete_opportunities, 143K cached USASpending awards) — one instant DB query, no live API.
--
-- Bucket bounds are clamped to the 5th-95th percentile of the SAME filtered set, not the raw
-- min/max: federal award data is heavily long-tailed (a handful of IDIQ-scale outliers can span
-- $100K-$400M+ even after the $500M cap), so equal-width buckets over the raw range collapse
-- ~95%+ of rows into one bar and leave the rest empty. Values outside the p5-p95 window are folded
-- into the first/last bucket (never dropped) so the total count is always preserved.
--
-- Returns null-ish (n=0, no rows) when comparables are too thin — the caller degrades to the
-- percentile-only display (never a fabricated/empty-looking chart).
CREATE OR REPLACE FUNCTION opp_value_histogram(p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_buckets int DEFAULT 10)
RETURNS TABLE (n bigint, bucket_min numeric, bucket_max numeric, count bigint)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT total_obligation AS amt
    FROM recompete_opportunities
    WHERE total_obligation BETWEEN 1000 AND 500000000
      AND (
        (length(p_naics) >= 6 AND naics_code = p_naics)
        OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
      )
      AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
      AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  ),
  bounds AS (
    SELECT
      COUNT(*)::bigint AS n,
      percentile_cont(0.05) WITHIN GROUP (ORDER BY amt) AS lo,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY amt) AS hi
    FROM filtered
  ),
  bucketed AS (
    SELECT
      -- Clamp every value into [1, p_buckets] so outliers below p5 / above p95 land in the
      -- edge buckets instead of erroring or being silently excluded (width_bucket() would
      -- return 0 or p_buckets+1 for out-of-range inputs).
      LEAST(GREATEST(width_bucket(f.amt, b.lo, GREATEST(b.hi, b.lo + 1), p_buckets), 1), p_buckets) AS bucket_idx
    FROM filtered f, bounds b
    WHERE b.n > 0
  )
  SELECT
    b.n,
    ROUND((b.lo + (x.bk - 1) * ((b.hi - b.lo) / p_buckets))::numeric, 2) AS bucket_min,
    ROUND((b.lo + x.bk * ((b.hi - b.lo) / p_buckets))::numeric, 2) AS bucket_max,
    x.cnt AS count
  FROM (
    SELECT bucket_idx AS bk, COUNT(*)::bigint AS cnt
    FROM bucketed
    GROUP BY bucket_idx
  ) x, bounds b
  ORDER BY x.bk;
$$;

GRANT EXECUTE ON FUNCTION opp_value_histogram(text, text, text, int) TO service_role;
