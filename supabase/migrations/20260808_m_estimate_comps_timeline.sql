-- M-Estimate(TM) DATED COMPS + VALUE-HISTORY TIMELINE (#88) — the two "why this number" surfaces
-- under the existing opp_value_range percentile RPC + opp_value_histogram distribution.
--
-- Both read the SAME cached recompete_opportunities table + the SAME filter (total_obligation
-- $1K-$500M outlier cap, 6-digit exact / short-code prefix NAICS, optional agency/sub-agency
-- conditioning) as opp_value_range, so the comps list, the timeline, the median/band and the
-- histogram all describe ONE comparable-award set — they can never disagree.
--
-- Zillow parity: opp_value_comps = "nearby sold homes" (the actual contracts behind the estimate);
-- opp_value_timeline = "price history" (median award $ per year). Both return null-ish (no rows)
-- when comparables are thin — the caller degrades to the percentile-only display, never fabricates.

-- ── COMPS: the top-N comparable awards behind the estimate, newest-first ──────────────────────
-- Returns real contracts (incumbent · $ · award/start date · sub-agency) so a user can see the
-- estimate is built from actual awards, not a black box. Ordered by most recent so the list reads
-- like a fresh comp set; NULL start dates sort last (kept, not dropped — they're still real comps).
DROP FUNCTION IF EXISTS opp_value_comps(text, text, text, int);
CREATE OR REPLACE FUNCTION opp_value_comps(p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_limit int DEFAULT 10)
RETURNS TABLE (
  incumbent_name text,
  total_obligation numeric,
  award_date date,
  awarding_sub_agency text,
  naics_code text
)
LANGUAGE sql STABLE AS $$
  SELECT
    incumbent_name,
    total_obligation,
    period_of_performance_start AS award_date,
    awarding_sub_agency,
    naics_code
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  ORDER BY period_of_performance_start DESC NULLS LAST, total_obligation DESC
  LIMIT GREATEST(1, LEAST(p_limit, 25));
$$;

GRANT EXECUTE ON FUNCTION opp_value_comps(text, text, text, int) TO service_role;

-- ── TIMELINE: median award $ per year (the value-history axis) ────────────────────────────────
-- Per calendar year (of period_of_performance_start): the MEDIAN award amount + the count of
-- comparables that year. Median (not mean) so a single IDIQ-scale outlier can't spike a year.
-- Only years with >= p_min_per_year comps are returned (a 1-contract year is noise, not a trend);
-- rows with a NULL start date are excluded here (a timeline needs a date) but still count in the
-- comps list + percentile band. Ascending by year so the caller draws left-to-right.
DROP FUNCTION IF EXISTS opp_value_timeline(text, text, text, int);
CREATE OR REPLACE FUNCTION opp_value_timeline(p_naics text, p_agency text DEFAULT NULL, p_sub text DEFAULT NULL, p_min_per_year int DEFAULT 2)
RETURNS TABLE (
  yr int,
  median_value numeric,
  n bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(YEAR FROM period_of_performance_start)::int AS yr,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation) AS median_value,
    COUNT(*)::bigint AS n
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND period_of_performance_start IS NOT NULL
    -- Guard against junk dates: only real, recent-ish contract years belong on the axis.
    AND period_of_performance_start >= DATE '2008-01-01'
    AND period_of_performance_start <= CURRENT_DATE
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
  GROUP BY EXTRACT(YEAR FROM period_of_performance_start)::int
  HAVING COUNT(*) >= GREATEST(1, p_min_per_year)
  ORDER BY yr ASC;
$$;

GRANT EXECUTE ON FUNCTION opp_value_timeline(text, text, text, int) TO service_role;
