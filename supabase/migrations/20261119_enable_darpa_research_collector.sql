-- NEEDS ERIC'S AUTHORIZATION. Do not apply in this change.
-- Apply only after the Grants.gov DARPA collector in this commit is on main:
--   npm run migrate -- --go --only 20261119_enable_darpa_research_collector.sql
--
-- What it does: re-enable snapshot-multisite-darpa. The collector no longer
-- returns a hardcoded opportunity list. It POSTs to Grants.gov search2 filtered
-- to DOD-DARPA-* and fail-closes on HTTP errors and on zero attributed rows.
-- The next scheduled run stamps research_darpa_baa. This file does not stamp
-- source_state=current and does not write aggregated_opportunities.
--
-- What it does NOT do: it does not enable snapshot-multisite-nsf.
-- Measured 2026-11-19: https://api.www.sbir.gov/public/api/solicitations?rows=1
-- returned HTTP 403 Forbidden. NSF stays parked. That is not zero NSF rows.

UPDATE public.cron_jobs
SET enabled = TRUE,
    notes = coalesce(notes, '') ||
      ' | 2026-11-19: re-enabled after the collector stopped returning a hardcoded list'
      || ' and started reading Grants.gov search2 (DOD-DARPA-* only, capped, fail-closed).'
      || ' NSF (snapshot-multisite-nsf) stays disabled: sbir.gov solicitations returned HTTP 403.'
WHERE job_name = 'snapshot-multisite-darpa'
  AND enabled IS FALSE;
