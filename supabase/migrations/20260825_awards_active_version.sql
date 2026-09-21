-- ============================================================================
-- Atomic awards version switch + async build queue  (2026-08-25)
--
-- WHY: the promote step was two statements —
--        UPDATE ... SET lifecycle='retired' WHERE lifecycle='live';
--        UPDATE ... SET lifecycle='live'    WHERE data_version=<staging>;
--
-- Between them, ZERO rows are live. A forced-failure test on 2026-08-25 proved
-- it: after the retire, `SELECT count(*) WHERE lifecycle='live'` returned 0.
--
-- The rollback added earlier only rescues a FAILED promotion. It does nothing
-- about the window itself, which opens on EVERY SUCCESSFUL refresh — concurrent
-- visitors mid-promote get the honest-unavailable state and a noindex on a page
-- that is perfectly fine. Having just spent this whole incident removing pages
-- that lied about their data, shipping a scheduled job that briefly makes 9,639
-- pages disappear would be the same mistake wearing a different hat.
--
-- FIX: a single-row POINTER. Readers resolve the active version in one read;
-- promotion is ONE atomic UPDATE. There is no intermediate state to observe:
-- a reader sees the old version or the new one, never zero and never a mix.
-- `lifecycle` stays for bookkeeping/rollback, but is no longer what defines
-- "live" for readers.
--
-- SAFETY: additive. Creates two tables + one function. Nothing dropped.
-- Idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ── 1. THE POINTER ──────────────────────────────────────────────────────────
-- Exactly one row, enforced by the CHECK on a fixed primary key. Swapping the
-- active generation is a single-row UPDATE: atomic by definition, no window.
CREATE TABLE IF NOT EXISTS public.awards_active_version (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_version     text        NOT NULL,
  -- Retained so a rollback is one UPDATE back, not a rebuild.
  previous_version   text,
  -- Upstream extent captured by the active generation.
  source_as_of       date,
  promoted_at        timestamptz NOT NULL DEFAULT now(),
  promoted_by        text
);

COMMENT ON TABLE public.awards_active_version IS
  'Single-row pointer to the live awards generation. Readers resolve this, so a '
  'promotion is one atomic UPDATE and no reader can observe zero-live or a mixed '
  'version. See 20260825_awards_active_version.sql for the window this closed.';

-- ── 2. THE ATOMIC SWITCH ────────────────────────────────────────────────────
-- Validates the target generation exists BEFORE switching, so the pointer can
-- never aim at nothing. Returns the row count it switched to.
CREATE OR REPLACE FUNCTION public.promote_awards_version(
  p_version text,
  p_source_as_of date DEFAULT NULL,
  p_promoted_by text DEFAULT NULL
) RETURNS TABLE (active_version text, previous_version text, pages int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pages int;
  v_prev  text;
BEGIN
  -- Refuse to point at a generation that is not there. A pointer to an empty
  -- version would take every page down at once — the exact failure mode this
  -- table exists to prevent.
  SELECT count(*) INTO v_pages
  FROM awards_serving_pages
  WHERE data_version = p_version;

  IF v_pages = 0 THEN
    RAISE EXCEPTION 'refusing to promote %: no rows for that data_version', p_version;
  END IF;

  SELECT a.active_version INTO v_prev FROM awards_active_version a WHERE a.id = 1;

  -- THE atomic statement. One row, one UPDATE, no observable intermediate.
  INSERT INTO awards_active_version (id, active_version, previous_version, source_as_of, promoted_at, promoted_by)
  VALUES (1, p_version, v_prev, p_source_as_of, now(), p_promoted_by)
  ON CONFLICT (id) DO UPDATE
    SET previous_version = awards_active_version.active_version,
        active_version   = EXCLUDED.active_version,
        source_as_of     = EXCLUDED.source_as_of,
        promoted_at      = now(),
        promoted_by      = EXCLUDED.promoted_by;

  RETURN QUERY SELECT p_version, v_prev, v_pages;
END;
$$;

COMMENT ON FUNCTION public.promote_awards_version IS
  'Atomically switch the active awards generation. Refuses to point at a version '
  'with zero rows. Readers never observe zero-live or a mixed version.';

-- ── 3. THE BUILD QUEUE ──────────────────────────────────────────────────────
-- Modelled on proposal_jobs (20260729): queued/running/done/error, attempts,
-- a worker lease via locked_at, and a partial index for cheap polling.
--
-- A ~4 minute build cannot run inside a 55s dispatcher request. Rather than
-- raise the timeout — which hides the mismatch and still loses the work if the
-- request is terminated — the check enqueues and a worker executes.
CREATE TABLE IF NOT EXISTS public.awards_build_jobs (
  id             bigserial PRIMARY KEY,
  -- Idempotency: one job per upstream source version. A second check on the same
  -- day cannot enqueue a duplicate build, and a retry re-uses the same row.
  source_version text        NOT NULL,
  status         text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','running','validated','promoted','failed')),
  attempts       int         NOT NULL DEFAULT 0,
  -- Worker lease. A crashed worker's job is reclaimable once this goes stale,
  -- rather than being stuck 'running' forever.
  locked_at      timestamptz,
  locked_by      text,
  heartbeat_at   timestamptz,
  staging_version text,
  error          text,
  telemetry      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awards_build_jobs_source_uniq UNIQUE (source_version)
);

CREATE INDEX IF NOT EXISTS awards_build_jobs_pending_idx
  ON public.awards_build_jobs (status, created_at)
  WHERE status IN ('queued','running');

COMMENT ON TABLE public.awards_build_jobs IS
  'Async awards rebuild queue. UNIQUE(source_version) makes enqueue idempotent: '
  'one build per upstream generation, and a retry reuses the row rather than '
  'promoting twice.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.awards_active_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awards_active_version FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS awards_active_version_service_only ON public.awards_active_version;
CREATE POLICY awards_active_version_service_only ON public.awards_active_version
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.awards_build_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awards_build_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS awards_build_jobs_service_only ON public.awards_build_jobs;
CREATE POLICY awards_build_jobs_service_only ON public.awards_build_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. SEED the pointer from the CURRENT live generation ────────────────────
-- Without this the pointer is empty and every page would read "unavailable" the
-- moment the new read path deploys. Seeding makes the switch invisible.
INSERT INTO public.awards_active_version (id, active_version, source_as_of, promoted_by)
SELECT 1, 'v3-2026-06', MAX(source_as_of), 'migration-seed'
FROM public.awards_serving_pages
WHERE lifecycle = 'live' AND data_version = 'v3-2026-06'
HAVING count(*) > 0
ON CONFLICT (id) DO NOTHING;

-- Verify:
--   SELECT * FROM awards_active_version;
--   SELECT promote_awards_version('v3-2026-06', DATE '2026-08-11', 'manual-test');
--   SELECT promote_awards_version('does-not-exist');  -- must RAISE
