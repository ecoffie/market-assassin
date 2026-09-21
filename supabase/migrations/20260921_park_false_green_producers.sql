-- Park the two producers that manufacture evidence of health (Workstream B, batch 2).
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- Measured on production over 30 days, on BOTH status and http_status:
--
--   snapshot-multisite-darpa   30 runs · 30 'success' · HTTP 200 → last wrote 2026-04-05 (168d)
--   snapshot-multisite-nsf     30 runs · 30 'success' · HTTP 200 → HAS NEVER WRITTEN A ROW
--
-- Sixty consecutive green checkmarks over two sources that produce nothing.
-- Running them unchanged does not merely fail to help — it actively manufactures
-- evidence that the corpus is healthy.
--
-- ── WHAT IS PRESERVED ──────────────────────────────────────────────────────
-- DARPA's 6 historical rows, both `data_source_instances` registrations, and all
-- provenance. Nothing is deleted. `research_expected_sources()` still names
-- `nsf_sbir`, so its absence stays VISIBLE rather than disappearing with the job.
--
-- ── WHY NIH IS NOT TOUCHED ─────────────────────────────────────────────────
-- NIH is classified by DATA MOVEMENT, not job status: 100 rows scraped in the
-- last 7 days, 451 in 30. It is advancing. Its permanent `dispatched`/NULL job
-- status is a REPORTING artifact (Workstream C), not a failed source — and it is
-- the only current SBIR feed. Confusing the two would have shut down the one
-- research source that works.
--
-- DIBBS and Grants are advancing (1d / 0d behind) and are likewise untouched.

-- ── 1. Stop the false-green producers ──────────────────────────────────────
-- Disabling is what removes the misleading signal. The rows stay so the schedule,
-- history and intent remain auditable.
UPDATE public.cron_jobs
SET enabled = FALSE,
    notes = coalesce(notes, '') ||
      ' | PARKED 2026-09-21: reported success/HTTP 200 on 30/30 runs while writing no data'
      || ' (DARPA last advanced 2026-04-05; NSF has never written a row). Disabled so the job'
      || ' can no longer manufacture evidence of health. Historical rows and source registration'
      || ' are preserved. Re-enable only with an upstream fix proven by DATA advancement.'
WHERE job_name IN ('snapshot-multisite-darpa', 'snapshot-multisite-nsf')
  AND enabled IS TRUE;

-- ── 2. Tell the truth in the control plane ─────────────────────────────────
-- `source_state` has no 'parked' value; the honest member of the existing
-- vocabulary is used for each, and `intervention_state='blocked'` carries the
-- parked-pending-a-decision fact. A human acknowledgement must never be able to
-- render the DATA current, so the two states stay independent.

-- DARPA: it once worked and has not advanced in 168 days → it cannot be reached.
-- NOT 'content_stale', which would imply routine lag.
UPDATE public.data_source_instances
SET source_state       = 'unreachable',
    intervention_state = 'blocked',
    manual_action_type = 'upstream_investigation',
    updated_at         = NOW()
WHERE source_key = 'research_darpa_baa';

-- NSF: never produced a row, so it CANNOT be stale — stale implies it once
-- worked. 'unmeasured' is the only truthful state for a source never observed.
UPDATE public.data_source_instances
SET source_state       = 'unmeasured',
    intervention_state = 'blocked',
    manual_action_type = 'upstream_investigation',
    updated_at         = NOW()
WHERE source_key = 'research_nsf_sbir';

-- ── 3. A parked producer must not read as healthy ──────────────────────────
-- Reports whether a source's producer is still scheduled, so "parked" is
-- observable next to advancement rather than inferred from a quiet clock.
CREATE OR REPLACE FUNCTION public.research_producer_status()
RETURNS TABLE(
  source text,
  job_name text,
  job_enabled boolean,
  rows_held bigint,
  last_scraped_at timestamptz,
  days_since_scrape integer,
  producer_state text
)
LANGUAGE sql
STABLE
AS $$
  WITH m(source, job_name) AS (
    VALUES ('nih_reporter', 'snapshot-multisite-nih'),
           ('darpa_baa',    'snapshot-multisite-darpa'),
           ('nsf_sbir',     'snapshot-multisite-nsf')
  ),
  d AS (
    SELECT a.source, count(*) AS n, max(a.scraped_at) AS last_scrape
    FROM public.aggregated_opportunities a GROUP BY a.source
  )
  SELECT m.source,
         m.job_name,
         j.enabled,
         coalesce(d.n, 0)::bigint,
         d.last_scrape,
         (CURRENT_DATE - d.last_scrape::date)::integer,
         CASE
           WHEN j.enabled IS NOT TRUE AND coalesce(d.n, 0) = 0 THEN 'parked_never_advanced'
           WHEN j.enabled IS NOT TRUE                          THEN 'parked_historical'
           WHEN d.last_scrape IS NULL                          THEN 'running_never_advanced'
           WHEN CURRENT_DATE - d.last_scrape::date > 30        THEN 'running_not_advancing'
           ELSE 'running_advancing'
         END
  FROM m
  LEFT JOIN d ON d.source = m.source
  LEFT JOIN public.cron_jobs j ON j.job_name = m.job_name;
$$;

COMMENT ON FUNCTION public.research_producer_status() IS
  'Producer schedule state beside data advancement. running_not_advancing / running_never_advanced are the false-green conditions: a job still scheduled while its source produces nothing. Parked sources report parked_*, never healthy.';
