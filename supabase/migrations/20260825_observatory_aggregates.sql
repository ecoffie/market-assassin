-- Observatory aggregates computed in the DATABASE, not from a page of rows.
--
-- THE DEFECT
-- Six Observatory sites requested up to 200,000 rows from tables holding 165,094.
-- PostgREST caps every response at 1,000 and returns no error, so metrics were
-- computed from a non-random prefix and presented as corpus-wide figures.
-- Measured 2026-08-24: corpus() reported 23 distinct users against an actual
-- 2,579 (-99.1%), and a lastDay one day stale.
--
-- THE FIX, IN ORDER OF PREFERENCE
-- 1. Aggregate in the database (this file). A distinct-user count should never be
--    derived from a row pull at all — no pagination, no cap, no ambiguity.
-- 2. Where rows genuinely must be materialised, page and PROVE exhaustion
--    (readAllPages in src/lib/paged-read.ts).
-- Every function here returns ONE row. There is nothing to truncate.

-- Corpus overview: events, distinct users, and the true date span.
CREATE OR REPLACE FUNCTION public.observatory_corpus()
RETURNS TABLE(events bigint, users bigint, first_day date, last_day date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::bigint,
         count(DISTINCT user_email)::bigint,
         min(created_at)::date,
         max(created_at)::date
  FROM user_engagement;
$function$;

-- Return behaviour: the habit curve, over the WHOLE population.
-- Distinct active days per user, then the distribution — all server-side.
CREATE OR REPLACE FUNCTION public.observatory_return_behavior()
RETURNS TABLE(users bigint, returners bigint, median_days integer, mean_days numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH per_user AS (
    SELECT user_email, count(DISTINCT created_at::date) AS days
    FROM user_engagement
    WHERE user_email IS NOT NULL AND user_email <> ''
    GROUP BY user_email
  )
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE days >= 2)::bigint,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::int,
         round(avg(days), 2)
  FROM per_user;
$function$;

-- Where attention concentrates, by agency. Top N over the whole population.
CREATE OR REPLACE FUNCTION public.observatory_attention_by_agency(p_limit int DEFAULT 8)
RETURNS TABLE(agency text, views bigint, users bigint, total_users bigint, total_views bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tagged AS (
    SELECT trim(metadata->>'agency') AS agency, user_email
    FROM user_engagement
    WHERE event_source IN ('source_feed','market_intelligence')
      AND event_type = 'tool_use'
      AND metadata->>'agency' IS NOT NULL
      AND trim(metadata->>'agency') <> ''
  ), totals AS (
    SELECT count(DISTINCT user_email)::bigint AS tu, count(*)::bigint AS tv FROM tagged
  )
  SELECT t.agency, count(*)::bigint, count(DISTINCT t.user_email)::bigint, totals.tu, totals.tv
  FROM tagged t CROSS JOIN totals
  GROUP BY t.agency, totals.tu, totals.tv
  ORDER BY count(*) DESC
  LIMIT p_limit;
$function$;

-- Discovery index: browse-without-pursue, across every source_feed event.
CREATE OR REPLACE FUNCTION public.observatory_discovery_index()
RETURNS TABLE(opens bigint, pursues bigint, open_users bigint, pursue_users bigint, engaged_users bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH acts AS (
    SELECT trim(metadata->>'action') AS action, user_email
    FROM user_engagement
    WHERE event_source = 'source_feed' AND event_type = 'tool_use'
  )
  -- 'save_to_pipeline' is the real action value, verified against the table.
  -- (An earlier draft guessed 'add_to_pipeline' and would have reported 0 pursues
  -- -- exactly the class of unverified assumption this whole repair is about.)
  SELECT count(*) FILTER (WHERE action = 'open_details')::bigint,
         count(*) FILTER (WHERE action = 'save_to_pipeline')::bigint,
         count(DISTINCT user_email) FILTER (WHERE action = 'open_details')::bigint,
         count(DISTINCT user_email) FILTER (WHERE action = 'save_to_pipeline')::bigint,
         count(DISTINCT user_email) FILTER (WHERE action IN ('open_details','save_to_pipeline'))::bigint
  FROM acts;
$function$;

-- Average decision time: discovery -> pursuit, over every stamped row.
CREATE OR REPLACE FUNCTION public.observatory_decision_time()
RETURNS TABLE(n bigint, median_hours numeric, mean_hours numeric, same_day bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT EXTRACT(EPOCH FROM (created_at - discovered_at)) / 3600.0 AS hours
    FROM user_pipeline
    WHERE discovered_at IS NOT NULL AND created_at >= discovered_at
  )
  SELECT count(*)::bigint,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY hours)::numeric, 2),
         round(avg(hours)::numeric, 2),
         count(*) FILTER (WHERE hours < 24)::bigint
  FROM d;
$function$;


-- Which DNA strands accompany attention. metadata->>'dna' may hold a JSON array
-- or a delimited string; both shapes are unnested server-side so the tally covers
-- every tagged event rather than the first 1,000.
CREATE OR REPLACE FUNCTION public.observatory_dna_attention(p_limit int DEFAULT 8)
RETURNS TABLE(strand text, events bigint, total_events bigint, tagged_events bigint, events_with_strands bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT metadata->'dna' AS dna_json, metadata->>'dna' AS dna_text
    FROM user_engagement
    WHERE event_source = 'source_feed' AND event_type = 'tool_use'
      AND metadata->>'dna' IS NOT NULL AND metadata->>'dna' <> ''
  ), expanded AS (
    -- A set-returning function cannot sit inside CASE, so the two shapes are
    -- unnested separately and unioned.
    SELECT jsonb_array_elements_text(dna_json) AS strand
      FROM src WHERE jsonb_typeof(dna_json) = 'array'
    UNION ALL
    SELECT unnest(regexp_split_to_array(trim(dna_text), '[,[:space:]]+')) AS strand
      FROM src WHERE jsonb_typeof(dna_json) IS DISTINCT FROM 'array'
  ), cleaned AS (
    SELECT trim(strand) AS strand FROM expanded WHERE trim(strand) <> ''
  ), totals AS (
    -- Report the denominator honestly: most 'dna' arrays are EMPTY (16,889 of
    -- 17,239 measured 2026-08-25), so the strand tally rests on a far smaller
    -- base than the tagged-event count suggests.
    SELECT (SELECT count(*)::bigint FROM cleaned) AS te,
           (SELECT count(*)::bigint FROM src) AS tagged,
           (SELECT count(*)::bigint FROM src WHERE jsonb_typeof(dna_json)='array'
              AND jsonb_array_length(dna_json) > 0) AS with_strands
  )
  SELECT c.strand, count(*)::bigint, totals.te, totals.tagged, totals.with_strands
  FROM cleaned c CROSS JOIN totals
  GROUP BY c.strand, totals.te, totals.tagged, totals.with_strands
  ORDER BY count(*) DESC
  LIMIT p_limit;
$function$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'observatory_corpus()',
    'observatory_return_behavior()',
    'observatory_attention_by_agency(int)',
    'observatory_discovery_index()',
    'observatory_decision_time()',
    'observatory_dna_attention(int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END
$grants$;
