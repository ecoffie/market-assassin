-- Specialty sources — per-SOURCE advancement + control-plane registration (Workstream C).
--
-- ── THE DEFECT: 60 GREEN CHECKMARKS OVER TWO DEAD SOURCES ──────────────────
-- Measured on production 2026-09-20, over the last 30 days:
--
--   snapshot-multisite-darpa   30 runs · 30 'success' · HTTP 200  → last wrote 2026-04-05 (168d)
--   snapshot-multisite-nsf     30 runs · 30 'success' · HTTP 200  → HAS NEVER WRITTEN A ROW
--   snapshot-multisite-nih     30 runs · 30 'dispatched' · NULL   → outcome never reported; 6d stale
--
-- DARPA and NSF are reporting a clean 200 every single day while producing
-- nothing. `aggregated_opportunities` has ONE dataset-level clock
-- (max(scraped_at)), and healthy NIH activity holds it near today — so the
-- dataset reads fresh while two of its three sources are corpses.
--
-- Job success is not data advancement, and a dataset clock is not a source clock.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- A PER-SOURCE advancement oracle, and `data_source_instances` rows for the four
-- specialty sources, which currently have NONE — so today they cannot be flagged
-- stale even in principle. Silence is indistinguishable from absence.
--
-- Nothing is repaired here. NSF is registered as having never advanced; DARPA is
-- registered as stale. Registering a dead source truthfully is the point — this
-- migration does not pretend anything is current.

-- ── 1. Per-source advancement for the multi-source research corpus ─────────
CREATE OR REPLACE FUNCTION public.research_source_advancement()
RETURNS TABLE(
  source text,
  rows_held bigint,
  last_scraped_at timestamptz,
  latest_source_date date,
  days_since_scrape integer,
  advancement_state text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.source,
    count(*)::bigint,
    max(a.scraped_at),
    max(a.posted_date)::date,
    (CURRENT_DATE - max(a.scraped_at)::date)::integer,
    CASE
      WHEN max(a.scraped_at) IS NULL                          THEN 'never_advanced'
      WHEN CURRENT_DATE - max(a.scraped_at)::date <= 3        THEN 'current'
      WHEN CURRENT_DATE - max(a.scraped_at)::date <= 30       THEN 'content_stale'
      ELSE 'dormant'
    END
  FROM public.aggregated_opportunities a
  GROUP BY a.source;
$$;

COMMENT ON FUNCTION public.research_source_advancement() IS
  'PER-SOURCE advancement for aggregated_opportunities. The dataset-level max(scraped_at) is held near today by healthy NIH traffic and masks darpa_baa (dormant 168d) and nsf_sbir (never wrote a row) — both of which report HTTP 200 success daily.';

-- ── 2. A source configured but never observed is NOT the same as absent ────
-- `nsf_sbir` has a cron, reports success, and appears NOWHERE in
-- aggregated_opportunities. A GROUP BY over the table therefore cannot see it —
-- the absence is invisible exactly where it matters. This function names the
-- sources we EXPECT and reports the ones that have never produced a row.
CREATE OR REPLACE FUNCTION public.research_expected_sources()
RETURNS TABLE(source text, rows_held bigint, ever_advanced boolean)
LANGUAGE sql
STABLE
AS $$
  SELECT e.source,
         coalesce(c.n, 0)::bigint,
         coalesce(c.n, 0) > 0
  FROM (VALUES ('nih_reporter'), ('grants_gov'), ('darpa_baa'), ('nsf_sbir')) AS e(source)
  LEFT JOIN (
    SELECT a.source, count(*) AS n FROM public.aggregated_opportunities a GROUP BY a.source
  ) c ON c.source = e.source;
$$;

COMMENT ON FUNCTION public.research_expected_sources() IS
  'Expected-vs-observed research sources. nsf_sbir is configured and reports success but has never written a row; a GROUP BY over the table alone cannot surface that absence.';

-- ── 3. Control-plane registration — truthful, not aspirational ─────────────
-- held_population is stamped from the live tables at apply time. upstream_population
-- stays NULL: none of these four expose a countable upstream total, and a guessed
-- denominator is worse than an absent one.
INSERT INTO public.data_source_instances
  (dataset_key, source_key, name, discovery_url, ingest_mode, owner, watch_cadence_days,
   held_population, source_state, intervention_state, runbook_path)
VALUES
  ('specialty_feeds', 'dibbs_rfqs',
   'DLA DIBBS RFQs', 'https://www.dibbs.bsm.dla.mil/', 'automated', 'data-core', 1,
   (SELECT count(*) FROM public.dibbs_rfqs),
   'current', 'none_required', 'docs/data-core-reliability-dibbs-grants-sbir.md'),

  ('specialty_feeds', 'grants_gov',
   'Grants.gov opportunities', 'https://www.grants.gov/', 'automated', 'data-core', 1,
   (SELECT count(*) FROM public.grants_cache),
   'current', 'none_required', 'docs/data-core-reliability-dibbs-grants-sbir.md'),

  ('specialty_feeds', 'research_nih_reporter',
   'NIH RePORTER (research + the ONLY SBIR feed)', 'https://api.reporter.nih.gov/', 'automated', 'data-core', 1,
   (SELECT count(*) FROM public.aggregated_opportunities WHERE source = 'nih_reporter'),
   'content_stale', 'required', 'docs/data-core-reliability-dibbs-grants-sbir.md'),

  ('specialty_feeds', 'research_darpa_baa',
   'DARPA BAA', 'https://www.darpa.mil/work-with-us/opportunities', 'automated', 'data-core', 7,
   (SELECT count(*) FROM public.aggregated_opportunities WHERE source = 'darpa_baa'),
   'content_stale', 'required', 'docs/data-core-reliability-dibbs-grants-sbir.md'),

  ('specialty_feeds', 'research_grants_gov_slice',
   'Grants.gov research slice', 'https://www.grants.gov/', 'automated', 'data-core', 7,
   (SELECT count(*) FROM public.aggregated_opportunities WHERE source = 'grants_gov'),
   'content_stale', 'required', 'docs/data-core-reliability-dibbs-grants-sbir.md'),

  -- NEVER produced a row. `unmeasured` is the honest state: we have never observed
  -- this source, so we cannot claim it is stale (that would imply it once worked).
  ('specialty_feeds', 'research_nsf_sbir',
   'NSF SBIR', 'https://www.nsf.gov/funding/', 'automated', 'data-core', 7,
   (SELECT count(*) FROM public.aggregated_opportunities WHERE source = 'nsf_sbir'),
   'unmeasured', 'required', 'docs/data-core-reliability-dibbs-grants-sbir.md')
ON CONFLICT (source_key) DO NOTHING;
