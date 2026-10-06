-- Competition Health: supplier-base breadth computed in the DATABASE, not from a page of rows.
--
-- THE DEFECT (measured 2026-10-06, DEPT OF DEFENSE, 90-day window)
-- computeCompetitionHealth() fetched award notices with `.limit(4000)`. PostgREST caps every
-- response at 1,000 rows (db-max-rows) and returns no error, so the "Who won" card was computed
-- from an arbitrary, unordered 1,000-row slice and presented as the population:
--   displayed  712 distinct winners   | actual 4,763 distinct winners across 17,742 notices
--   displayed   10 first-time winners | (top 15 of the slice only — not a population figure)
--   top-3 share of $                  | computed over the slice, not the population
-- Same class as tasks/OBSERVATORY-TRUNCATION-DEFECT.md and 20260825_observatory_aggregates.sql.
--
-- THE FIX
-- One function, one row, nothing to truncate. Read-only (STABLE, SELECT only), SECURITY INVOKER,
-- fixed search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role only.
--
-- DEFINITIONS (these are what the admin card states)
--   award notice   = sam_opportunities row, notice_type = 'Award Notice', non-blank awardee_name,
--                    at this SAM department, posted_date in [p_since, p_until).
--                    posted_date, not award_date: the awardee backfill left award_date with
--                    parse-garbage (year 2260, future dates) on many rows.
--   winner         = distinct trim(awardee_name). Exact-name identity (case-sensitive), so
--                    case variants of one firm count separately (DoD 90d: 4,763 exact vs 4,729
--                    case-folded). UEI is filled on only ~52% of award notices, so it is not yet
--                    usable as the identity key.
--   first-time     = a winner with NO award notice at this department posted before p_since.
--                    Bounded by how far back the record goes: returned as lookback_start so the
--                    caller can refuse to call it "first-time" when the history is too short
--                    (the whole corpus starts 2026-03-15).
--   concentration  = top-3 winners' share of summed positive award_amount (amounts as reported
--                    on the award notice, unaudited).

CREATE OR REPLACE FUNCTION public.competition_health_winners(
  p_department text,
  p_since timestamptz,
  p_until timestamptz,
  p_top int DEFAULT 6
)
RETURNS TABLE(
  awards bigint,
  distinct_winners bigint,
  awards_with_amount bigint,
  total_dollars numeric,
  top3_dollars numeric,
  first_time_winners bigint,
  lookback_start timestamptz,
  top_winners jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER          -- runs with the caller's rights; only service_role may call it (below),
                          -- and service_role already reads both tables. No definer escalation needed.
SET search_path TO 'public'
AS $function$
  WITH win AS (
    SELECT trim(awardee_name) AS name, award_amount AS amt
    FROM sam_opportunities
    WHERE department = p_department
      AND notice_type = 'Award Notice'
      AND awardee_name IS NOT NULL AND trim(awardee_name) <> ''
      AND posted_date >= p_since AND posted_date < p_until
  ), per_vendor AS (
    SELECT name,
           count(*)::bigint AS awards,
           coalesce(sum(amt) FILTER (WHERE amt > 0), 0) AS total
    FROM win
    GROUP BY name
  ), ranked AS (
    SELECT per_vendor.*, row_number() OVER (ORDER BY total DESC, name) AS rk FROM per_vendor
  ), prior AS (
    SELECT DISTINCT trim(awardee_name) AS name
    FROM sam_opportunities
    WHERE department = p_department
      AND notice_type = 'Award Notice'
      AND awardee_name IS NOT NULL AND trim(awardee_name) <> ''
      AND posted_date < p_since
  )
  SELECT
    (SELECT count(*) FROM win)::bigint,
    (SELECT count(*) FROM per_vendor)::bigint,
    (SELECT count(*) FROM win WHERE amt > 0)::bigint,
    (SELECT coalesce(sum(total), 0) FROM per_vendor),
    (SELECT coalesce(sum(total), 0) FROM ranked WHERE rk <= 3),
    (SELECT count(*) FROM per_vendor v WHERE NOT EXISTS (SELECT 1 FROM prior p WHERE p.name = v.name))::bigint,
    (SELECT min(posted_date) FROM sam_opportunities
       WHERE department = p_department AND notice_type = 'Award Notice'),
    coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'total', total, 'awards', awards) ORDER BY rk)
              FROM ranked WHERE rk <= greatest(p_top, 0)), '[]'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.competition_health_winners(text, timestamptz, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_health_winners(text, timestamptz, timestamptz, int) TO service_role;
