-- NOT APPLIED.
-- Do not apply this migration, create these roles, set the rotator credential,
-- deploy the route, or set any secret until Eric's written authorization for
-- this release package. After that authorization, and only then:
--   npm run migrate -- --go --only 20261119_scorecard_reader.sql
--
-- scorecard_reader is a direct SQL login. No password is stored in this file.
-- Agent 5 sets the one-time rotator password out of band. Each scorecard run
-- receives a new reader password that expires in 30 minutes.
--
-- PostgREST is not used. authenticator is not granted this role. A JWT role
-- claim cannot become scorecard_reader.
--
-- The reader has column SELECT only. institute_sources.raw is not granted.
-- scorecard_institute_resolution is SECURITY DEFINER and returns id,
-- discovered_at, resolution_status, and resolution_flag. It does not return
-- the text stored inside raw.
--
-- scorecard_rotator can only EXECUTE scorecard_rotate_reader_password.
-- That function is the only path that may ALTER ROLE scorecard_reader.
-- Its owner is the migration role, which created scorecard_reader and can
-- alter that one role. The function search_path is pg_catalog.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scorecard_reader') THEN
    CREATE ROLE scorecard_reader LOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 3;
  END IF;
END $$;

ALTER ROLE scorecard_reader LOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 3;
ALTER ROLE scorecard_reader SET default_transaction_read_only = on;
ALTER ROLE scorecard_reader SET statement_timeout = '20s';
ALTER ROLE scorecard_reader SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE scorecard_reader SET idle_session_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scorecard_rotator') THEN
    CREATE ROLE scorecard_rotator LOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 2;
  END IF;
END $$;

ALTER ROLE scorecard_rotator LOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 2;
ALTER ROLE scorecard_rotator SET statement_timeout = '5s';

GRANT USAGE ON SCHEMA public TO scorecard_reader;
GRANT USAGE ON SCHEMA public TO scorecard_rotator;

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

GRANT SELECT (job_name, enabled)
  ON TABLE public.cron_jobs TO scorecard_reader;

GRANT SELECT (job_name, started_at, finished_at, status, http_status)
  ON TABLE public.cron_job_runs TO scorecard_reader;

GRANT SELECT (created_at, last_modified)
  ON TABLE public.sam_opportunities TO scorecard_reader;

GRANT SELECT (created_at, title, source_agency, source_url)
  ON TABLE public.agency_forecasts TO scorecard_reader;

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

CREATE OR REPLACE FUNCTION public.scorecard_institute_resolution(source_ids uuid[])
RETURNS TABLE (
  id uuid,
  discovered_at timestamptz,
  resolution_status text,
  resolution_flag text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    s.id,
    s.discovered_at,
    CASE
      WHEN s.raw #>> '{acquisition,resolution_status}' IN ('open', 'closed')
        THEN s.raw #>> '{acquisition,resolution_status}'
      ELSE 'unknown'
    END,
    CASE s.raw #>> '{acquisition,resolution_status}'
      WHEN 'open' THEN 'confirmed_unresolved'
      WHEN 'closed' THEN 'historical'
      ELSE 'unknown'
    END
  FROM public.institute_sources s
  WHERE source_ids IS NOT NULL
    AND s.id = ANY(source_ids);
$$;

REVOKE ALL ON FUNCTION public.scorecard_institute_resolution(uuid[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.scorecard_institute_resolution(uuid[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.scorecard_institute_resolution(uuid[]) FROM authenticated;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.scorecard_institute_resolution(uuid[]) TO scorecard_reader;

CREATE TABLE IF NOT EXISTS public.scorecard_credential_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jti text NOT NULL UNIQUE,
  run_id text NOT NULL,
  actor text NOT NULL,
  event_name text NOT NULL,
  repository text NOT NULL,
  workflow_ref text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.scorecard_credential_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.scorecard_rotate_reader_password(
  p_jti text,
  p_run_id text,
  p_actor text,
  p_event_name text,
  p_repository text,
  p_workflow_ref text
) RETURNS TABLE (password text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  pw text;
  exp timestamptz;
  recent integer;
BEGIN
  IF p_jti IS NULL OR length(btrim(p_jti)) < 8 THEN
    RAISE EXCEPTION 'scorecard rotation refused: jti' USING ERRCODE = '22023';
  END IF;
  IF p_run_id IS NULL OR length(btrim(p_run_id)) < 1 THEN
    RAISE EXCEPTION 'scorecard rotation refused: run' USING ERRCODE = '22023';
  END IF;
  IF p_repository IS DISTINCT FROM 'ecoffie/market-assassin' THEN
    RAISE EXCEPTION 'scorecard rotation refused: repository' USING ERRCODE = '42501';
  END IF;
  IF p_event_name NOT IN ('schedule', 'workflow_dispatch') THEN
    RAISE EXCEPTION 'scorecard rotation refused: event' USING ERRCODE = '42501';
  END IF;
  IF p_workflow_ref IS NULL
     OR position('.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main' IN p_workflow_ref) = 0 THEN
    RAISE EXCEPTION 'scorecard rotation refused: workflow' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scorecard_credential_audit a WHERE a.jti = p_jti) THEN
    RAISE EXCEPTION 'scorecard rotation refused: replay' USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer INTO recent
  FROM public.scorecard_credential_audit a
  WHERE a.created_at > pg_catalog.now() - interval '1 hour';
  IF recent >= 6 THEN
    RAISE EXCEPTION 'scorecard rotation refused: rate' USING ERRCODE = '53300';
  END IF;

  pw := replace(pg_catalog.gen_random_uuid()::text, '-', '')
     || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  exp := pg_catalog.now() + interval '30 minutes';

  EXECUTE format('ALTER ROLE scorecard_reader PASSWORD %L VALID UNTIL %L', pw, exp);

  INSERT INTO public.scorecard_credential_audit
    (jti, run_id, actor, event_name, repository, workflow_ref, expires_at)
  VALUES (
    p_jti,
    p_run_id,
    COALESCE(NULLIF(btrim(p_actor), ''), 'unknown'),
    p_event_name,
    p_repository,
    p_workflow_ref,
    exp
  );

  password := pw;
  expires_at := exp;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) FROM authenticated;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) FROM scorecard_reader;
GRANT EXECUTE ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) TO scorecard_rotator;

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

-- ============================================================================
-- ROLLBACK — do not apply with this migration. Run only to remove the roles.
-- ============================================================================
-- DROP POLICY IF EXISTS scorecard_reader_select ON public.institute_sources;
-- DROP POLICY IF EXISTS scorecard_reader_select ON public.data_source_instances;
-- REVOKE EXECUTE ON FUNCTION public.scorecard_rotate_reader_password(text,text,text,text,text,text) FROM scorecard_rotator;
-- DROP FUNCTION IF EXISTS public.scorecard_rotate_reader_password(text,text,text,text,text,text);
-- DROP TABLE IF EXISTS public.scorecard_credential_audit;
-- REVOKE EXECUTE ON FUNCTION public.scorecard_institute_resolution(uuid[]) FROM scorecard_reader;
-- DROP FUNCTION IF EXISTS public.scorecard_institute_resolution(uuid[]);
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
-- REVOKE USAGE ON SCHEMA public FROM scorecard_rotator;
-- DROP ROLE IF EXISTS scorecard_rotator;
-- DROP ROLE IF EXISTS scorecard_reader;
