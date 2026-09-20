-- sam_opportunities — control-plane registration (Workstream A3).
--
-- ── WHY THIS MATTERS MORE THAN ITS SIZE SUGGESTS ───────────────────────────
-- RES-003 "Small-Business Participation Benchmark" is the Mindy Institute's ONLY
-- public publication (/research/small-business-participation-benchmark). Every
-- figure on it — 40.7% government-wide participation, 34,684 active
-- solicitations, 14,114 carrying a set-aside — is an exact head-count over
-- `sam_opportunities`, and it recomputes on each request.
--
-- `sam_opportunities` has a `data_sources` row but NO `data_source_instances`
-- row, so it carries no clocks, no source_state and no intervention_state. A
-- publication that regenerates from a silently-stale input would keep serving
-- confident numbers with no way for the control plane to notice. Freshness is
-- not currentness, and a page that recomputes is not the same as a page that is
-- correct.
--
-- Measured 2026-09-20: 215,066 rows, 34,684 active, max(posted_date) = today
-- (0 days behind source), last write 13:00Z by `sync-sam-opportunities-delta`.
--
-- ⚠️ Two of the three SAM sync jobs (`-full`, `-resume`) sit at
-- status='dispatched', http_status=NULL and never resolve, so the JOB rows
-- cannot establish advancement. The oracle below is the DATA clock
-- (max(posted_date) vs today), never a job status.

-- Advancement oracle — source date vs today. Never a Mindy ingest timestamp.
CREATE OR REPLACE FUNCTION public.sam_opportunities_advancement()
RETURNS TABLE(
  rows_held bigint,
  active_rows bigint,
  latest_posted date,
  days_behind_source integer,
  advancement_state text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE active)::bigint,
    max(posted_date)::date,
    (CURRENT_DATE - max(posted_date)::date)::integer,
    CASE
      WHEN max(posted_date) IS NULL                        THEN 'unmeasured'
      -- SAM posts on business days; a quiet weekend is healthy, not stale.
      WHEN CURRENT_DATE - max(posted_date)::date <= 3      THEN 'current'
      WHEN CURRENT_DATE - max(posted_date)::date <= 14     THEN 'content_stale'
      ELSE 'unreachable'
    END
  FROM public.sam_opportunities;
$$;

COMMENT ON FUNCTION public.sam_opportunities_advancement() IS
  'Data clock for sam_opportunities: max(posted_date) vs today. Two of the three SAM sync jobs never resolve their status, so job rows cannot establish advancement — this can. Backs RES-003, the Institute''s only public publication.';

INSERT INTO public.data_source_instances
  (dataset_key, source_key, name, discovery_url, ingest_mode, owner, watch_cadence_days,
   held_population, source_state, intervention_state, runbook_path)
VALUES
  -- dataset_key is a FOREIGN KEY to data_sources(key). 'sam_opportunities' is an
  -- existing dataset there; an invented key ('opportunities') fails the FK — which
  -- is how the first apply attempt was caught, and correctly rolled back.
  ('sam_opportunities', 'sam_opportunities_sam_gov',
   'SAM.gov opportunities (backs RES-003)',
   'https://api.sam.gov/opportunities/v2/search',
   'automated', 'data-core', 1,
   (SELECT count(*) FROM public.sam_opportunities),
   -- Stamped from the live data clock at apply time, not asserted.
   (SELECT advancement_state FROM public.sam_opportunities_advancement()),
   'none_required',
   'docs/strategic-intelligence-source-control-plane.md')
ON CONFLICT (source_key) DO NOTHING;
