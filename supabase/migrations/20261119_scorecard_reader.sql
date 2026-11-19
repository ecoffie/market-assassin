-- Read-only PostgREST role for the weekday acquisition scorecard.
-- Additive. Does not alter existing roles or policies. Do not apply from an
-- agent session. Apply later with:
--   npm run migrate -- --go --only 20261119_scorecard_reader.sql
--
-- Why a role, not the service-role key: the service role bypasses RLS and can
-- write. This role is NOLOGIN and has SELECT on named columns only. PostgREST
-- switches to it when the request JWT's role claim is scorecard_reader.
-- authenticator must be able to SET ROLE, which is the GRANT below.
--
-- RLS: data_source_instances and institute_sources have RLS and no policy that
-- applies to a new role. Without a SELECT policy, PostgREST returns zero rows
-- with HTTP 200, and the scorecard would treat that as a real zero. The two
-- policies below are FOR SELECT TO scorecard_reader only.
-- sam_opportunities, agency_forecasts, and agency_pain_points_db already have
-- a SELECT/ALL policy USING (true) for every role, so no new policy is added.
-- cron_jobs and cron_job_runs were created without RLS.
--
-- institute_sources.raw is NOT granted. That column holds recommendation text
-- and resolution flags. The scorecard findability path uses a thinner select
-- that never asks for raw. New-row counts (discovered_at / created_at) stay
-- separate from customer-findability metrics.
--
-- Credential (supported path — no Mac JWT minting):
-- Store the project's legacy JWT HS256 secret once as the Actions secret
-- SCORECARD_JWT_SECRET. The weekday workflow runs
-- scripts/scorecard-mint-jwt.mjs at job start, which mints a short-lived
-- (2h) HS256 token with "role": "scorecard_reader", masks it, and writes it
-- to GITHUB_ENV as SCORECARD_READONLY_JWT. Rotate by rotating the Actions
-- secret SCORECARD_JWT_SECRET when the project signing secret changes. Do
-- not mint 30-day JWTs on a laptop. Do not put the signing secret or the
-- token in a log, commit, or PR.
--
-- Settings → API → JWT tells you which signer is active. This path requires
-- the legacy JWT secret still enabled (HS256). If only asymmetric signing
-- keys are listed, stop and extend the mint script for that signer before
-- apply — do not hand-mint. Confirm the gateway accepts the token as apikey.
-- If it accepts only the anon or service-role key there, send the anon key
-- as apikey and this token as Authorization.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scorecard_reader') THEN
    CREATE ROLE scorecard_reader NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT scorecard_reader TO authenticator;
GRANT USAGE ON SCHEMA public TO scorecard_reader;

-- Freshness and source status. Not held_population, notes, or intervention state.
GRANT SELECT (
  source_key,
  name,
  dataset_key,
  source_state,
  watch_cadence_days,
  last_poll,
  last_successful_check,
  last_verified_ingest,
  last_data_advance
) ON TABLE public.data_source_instances TO scorecard_reader;

-- Whether the producer cron is enabled. route is not granted (it has carried secrets).
GRANT SELECT (job_name, enabled)
  ON TABLE public.cron_jobs TO scorecard_reader;

-- Latest run status only. error text is not granted.
GRANT SELECT (job_name, started_at, finished_at, status, http_status)
  ON TABLE public.cron_job_runs TO scorecard_reader;

-- New notices (created_at) and SAM's own lastModifiedDate. Not synced_at.
GRANT SELECT (created_at, last_modified)
  ON TABLE public.sam_opportunities TO scorecard_reader;

-- New forecast rows and the public example fields. Not updated_at or last_synced_at.
GRANT SELECT (created_at, title, source_agency, source_url)
  ON TABLE public.agency_forecasts TO scorecard_reader;

-- New pain points, the public example, and the columns getAgencySourcedIntelligence
-- selects or orders by (source, confidence, status, last_evidence_at).
GRANT SELECT (
  id,
  agency,
  pain_point,
  source,
  source_url,
  institute_source_ids,
  confidence,
  status,
  last_evidence_at,
  created_at
) ON TABLE public.agency_pain_points_db TO scorecard_reader;

-- Institute identity for GAO/IG findability and the discovered_at new-row clock.
-- raw (recommendation / resolution) is deliberately omitted.
GRANT SELECT (
  id,
  source_type,
  document_number,
  source_url,
  publication_date,
  title,
  canonical_agency,
  discovered_at
) ON TABLE public.institute_sources TO scorecard_reader;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'data_source_instances'
      AND policyname = 'scorecard_reader_select'
  ) THEN
    CREATE POLICY scorecard_reader_select
      ON public.data_source_instances
      FOR SELECT
      TO scorecard_reader
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'institute_sources'
      AND policyname = 'scorecard_reader_select'
  ) THEN
    CREATE POLICY scorecard_reader_select
      ON public.institute_sources
      FOR SELECT
      TO scorecard_reader
      USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK — do not apply with this migration. Run only to remove the role.
-- ============================================================================
-- DROP POLICY IF EXISTS scorecard_reader_select ON public.institute_sources;
-- DROP POLICY IF EXISTS scorecard_reader_select ON public.data_source_instances;
-- REVOKE SELECT (
--   id, source_type, document_number, source_url, publication_date, title,
--   canonical_agency, discovered_at
-- ) ON TABLE public.institute_sources FROM scorecard_reader;
-- REVOKE SELECT (
--   id, agency, pain_point, source, source_url, institute_source_ids,
--   confidence, status, last_evidence_at, created_at
-- ) ON TABLE public.agency_pain_points_db FROM scorecard_reader;
-- REVOKE SELECT (created_at, title, source_agency, source_url)
--   ON TABLE public.agency_forecasts FROM scorecard_reader;
-- REVOKE SELECT (created_at, last_modified)
--   ON TABLE public.sam_opportunities FROM scorecard_reader;
-- REVOKE SELECT (job_name, started_at, finished_at, status, http_status)
--   ON TABLE public.cron_job_runs FROM scorecard_reader;
-- REVOKE SELECT (job_name, enabled) ON TABLE public.cron_jobs FROM scorecard_reader;
-- REVOKE SELECT (
--   source_key, name, dataset_key, source_state, watch_cadence_days,
--   last_poll, last_successful_check, last_verified_ingest, last_data_advance
-- ) ON TABLE public.data_source_instances FROM scorecard_reader;
-- REVOKE USAGE ON SCHEMA public FROM scorecard_reader;
-- REVOKE scorecard_reader FROM authenticator;
-- DROP ROLE IF EXISTS scorecard_reader;
