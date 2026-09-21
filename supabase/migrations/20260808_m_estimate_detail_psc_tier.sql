-- M-Estimate detail on the PSC tier (#88 follow-up). The band (opp_value_range) already narrows to
-- the PSC/FSC FAMILY when p_psc is given (20260803_value_range_psc.sql); its three DETAIL surfaces —
-- the distribution histogram, the dated comps list, and the value-history timeline — did NOT, so on a
-- PSC-scoped opp (most of them carry a PSC) they were deliberately hidden to avoid showing NAICS-keyed
-- detail beside a PSC-scoped band. Eric: add PSC-scoped detail so all three MATCH the band and render.
--
-- Adds p_psc (+ p_psc_prefix_len, default 2 = the FSC group) to opp_value_histogram / opp_value_comps
-- / opp_value_timeline, using the EXACT same CASE as opp_value_range: when p_psc is given, narrow on
-- the PSC family (psc_code LIKE left(p_psc,2)||'%') INSTEAD of the NAICS filter (they contradict for a
-- product buy — ANDing them collapses the set). Additive + backward compatible: p_psc DEFAULT NULL, so
-- every existing 3/4-arg call behaves EXACTLY as before. Same $1K-$500M cap + agency/sub conditioning.

-- ── HISTOGRAM + p_psc ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION opp_value_histogram(
  p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_buckets int DEFAULT 10,
  p_psc text DEFAULT NULL, p_psc_prefix_len int DEFAULT 2
)
RETURNS TABLE (n bigint, bucket_min numeric, bucket_max numeric, count bigint)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT total_obligation AS amt
    FROM recompete_opportunities
    WHERE total_obligation BETWEEN 1000 AND 500000000
      AND (
        CASE WHEN p_psc IS NULL THEN
          ((length(p_naics) >= 6 AND naics_code = p_naics)
           OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%'))
        ELSE
          (psc_code IS NOT NULL
           AND upper(psc_code) LIKE upper(left(p_psc, greatest(p_psc_prefix_len, 1))) || '%')
        END
      )
      AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
      AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  ),
  bounds AS (
    SELECT COUNT(*)::bigint AS n,
      percentile_cont(0.05) WITHIN GROUP (ORDER BY amt) AS lo,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY amt) AS hi
    FROM filtered
  ),
  bucketed AS (
    SELECT LEAST(GREATEST(width_bucket(f.amt, b.lo, GREATEST(b.hi, b.lo + 1), p_buckets), 1), p_buckets) AS bucket_idx
    FROM filtered f, bounds b WHERE b.n > 0
  )
  SELECT b.n,
    ROUND((b.lo + (x.bk - 1) * ((b.hi - b.lo) / p_buckets))::numeric, 2) AS bucket_min,
    ROUND((b.lo + x.bk * ((b.hi - b.lo) / p_buckets))::numeric, 2) AS bucket_max,
    x.cnt AS count
  FROM (SELECT bucket_idx AS bk, COUNT(*)::bigint AS cnt FROM bucketed GROUP BY bucket_idx) x, bounds b
  ORDER BY x.bk;
$$;
GRANT EXECUTE ON FUNCTION opp_value_histogram(text, text, text, int, text, int) TO service_role;

-- ── COMPS + p_psc ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION opp_value_comps(
  p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_limit int DEFAULT 10,
  p_psc text DEFAULT NULL, p_psc_prefix_len int DEFAULT 2
)
RETURNS TABLE (incumbent_name text, total_obligation numeric, award_date date, awarding_sub_agency text, naics_code text)
LANGUAGE sql STABLE AS $$
  SELECT incumbent_name, total_obligation, period_of_performance_start AS award_date, awarding_sub_agency, naics_code
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      CASE WHEN p_psc IS NULL THEN
        ((length(p_naics) >= 6 AND naics_code = p_naics)
         OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%'))
      ELSE
        (psc_code IS NOT NULL
         AND upper(psc_code) LIKE upper(left(p_psc, greatest(p_psc_prefix_len, 1))) || '%')
      END
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  ORDER BY period_of_performance_start DESC NULLS LAST, total_obligation DESC
  LIMIT GREATEST(1, LEAST(p_limit, 25));
$$;
GRANT EXECUTE ON FUNCTION opp_value_comps(text, text, text, int, text, int) TO service_role;

-- ── TIMELINE + p_psc ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION opp_value_timeline(
  p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_min_per_year int DEFAULT 2,
  p_psc text DEFAULT NULL, p_psc_prefix_len int DEFAULT 2
)
RETURNS TABLE (yr int, median_value numeric, n bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(YEAR FROM period_of_performance_start)::int AS yr,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation) AS median_value,
    COUNT(*)::bigint AS n
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND period_of_performance_start IS NOT NULL
    AND period_of_performance_start >= DATE '2008-01-01'
    AND period_of_performance_start <= CURRENT_DATE
    AND (
      CASE WHEN p_psc IS NULL THEN
        ((length(p_naics) >= 6 AND naics_code = p_naics)
         OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%'))
      ELSE
        (psc_code IS NOT NULL
         AND upper(psc_code) LIKE upper(left(p_psc, greatest(p_psc_prefix_len, 1))) || '%')
      END
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  GROUP BY EXTRACT(YEAR FROM period_of_performance_start)::int
  HAVING COUNT(*) >= GREATEST(1, p_min_per_year)
  ORDER BY yr ASC;
$$;
GRANT EXECUTE ON FUNCTION opp_value_timeline(text, text, text, int, text, int) TO service_role;
