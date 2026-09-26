-- Grants cache reconcile (2026-09-26) — record-preserving, evidence-gated staleness.
--
-- Problem (tasks/grants-gov-path-health-2026-09-26.md): the nightly Grants.gov ingest only UPSERTS, so a
-- grant Grants.gov stops listing stays in grants_cache looking actionable forever. Measured 2026-09-26:
-- 103 rows not seen by a complete run still rendered as actionable on the Grants map.
--
-- Design — two SEPARATE facts, never conflated:
--   * absent_since   — OUR evidence: the row was not in a PROVEN-COMPLETE ingest snapshot (every status's
--                      unique fetch == its upstream hitCount, no degraded page, no error). Cleared the
--                      moment a later run sees the row again. Absence alone never means "closed".
--   * source_status  — THE SOURCE's statement, from the official fetchOpportunity API:
--                      posted | forecast (live) · closed | archived (gone) · not_found (AMBIGUOUS).
--                      Only written from a well-formed API answer; an API error/timeout leaves it NULL.
--   * superseded_by  — identity: the SAME Grants.gov opportunity id is listed in the complete snapshot under
--                      a NEW funding-opportunity number (forecast → posting, reissue). Holds that number.
--
-- Visibility (Eric, 2026-09-26): absence alone NEVER hides a grant. Hidden from actionable results only:
--   source_status IN (closed, archived)  — confirmed gone (record kept), and
--   superseded_by IS NOT NULL            — a duplicate; the grant stays visible once via its current row.
-- Absent + unverified, lookup failed/timed out, or not_found → still VISIBLE, labelled.
-- Measured 2026-09-26: 17 of 103 absent rows were live, every one re-listed under a new number.
--   * last_seen_at   — the last ingest snapshot that listed the row.
-- No row is ever deleted.
--
-- grants_ingest_runs persists each run's per-status completeness evidence (expected hitCount, unique
-- fetched, pages, degraded, error) plus what reconcile/confirmation did — so "was that run complete?"
-- is answerable afterwards, and a future 500 is diagnosable (the 2026-09-19 cause was lost).
--
-- The code is SAFE WITHOUT this migration: it probes for these columns/table and, if missing, keeps the
-- old upsert-only behaviour and skips reconcile/confirmation with a logged reason. Apply the migration
-- first, then deploy (or either order — neither hides a grant before both are present).
--
-- Idempotent. Applied by `npm run migrate` only after sign-off. NOT applied by this PR.

ALTER TABLE public.grants_cache ADD COLUMN IF NOT EXISTS last_seen_at      timestamptz;
ALTER TABLE public.grants_cache ADD COLUMN IF NOT EXISTS absent_since      timestamptz;
ALTER TABLE public.grants_cache ADD COLUMN IF NOT EXISTS source_status     text;
ALTER TABLE public.grants_cache ADD COLUMN IF NOT EXISTS source_checked_at timestamptz;
ALTER TABLE public.grants_cache ADD COLUMN IF NOT EXISTS superseded_by     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grants_cache_source_status_chk') THEN
    ALTER TABLE public.grants_cache
      ADD CONSTRAINT grants_cache_source_status_chk
      CHECK (source_status IS NULL OR source_status IN ('posted', 'forecast', 'closed', 'archived', 'not_found'));
  END IF;
END $$;

-- The confirmation step and the read path both select "absent" rows; keep that cheap.
CREATE INDEX IF NOT EXISTS grants_cache_absent_idx
  ON public.grants_cache (absent_since)
  WHERE absent_since IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.grants_ingest_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  complete     boolean NOT NULL,          -- every status proven complete this run
  degraded     boolean NOT NULL,
  per_status   jsonb NOT NULL,            -- { posted: {expected, fetchedUnique, pages, degraded, error, complete, reason}, ... }
  reconcile    jsonb,                     -- { ran, reason, markedAbsent, actionableMarkedAbsent, superseded, restored }
  confirm      jsonb,                     -- { attempted, confirmed: {status: n}, unconfirmed }
  error        text
);
CREATE INDEX IF NOT EXISTS grants_ingest_runs_started_idx ON public.grants_ingest_runs (started_at DESC);

ALTER TABLE public.grants_ingest_runs ENABLE ROW LEVEL SECURITY;

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'grants_cache'
--     AND column_name IN ('last_seen_at','absent_since','source_status','source_checked_at');
--   SELECT to_regclass('public.grants_ingest_runs');
--   (and through PostgREST — the surface the app uses: npm run db:check -- grants_cache absent_since)
