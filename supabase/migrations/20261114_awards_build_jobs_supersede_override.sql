-- Awards build queue: supersession + one-time size override (2026-11-14).
--
-- WHY
-- ---
-- awards-refresh enqueues one build job per upstream source version, but nothing ran the
-- worker, so jobs 5-12 (2026-09-07 .. 2026-11-09) piled up as 'queued'. The worker claims the
-- OLDEST job first, so scheduling it would have run every stale job as a full ~17 GiB rebuild.
-- A newer upstream version makes every older queued job redundant: 'superseded' records that
-- without deleting the row (the queue is the audit history).
--
-- The size (plausibility) check refuses a build whose recipient or page count moves more than
-- 10% from live. The child-UEI build fix moves both legitimately (+25% recipients, +32% pages).
-- size_override is the explicit, per-job authorization for that one build: it lives on the job
-- row, names its source version and expected ranges, and is read for that job only.
--
-- Additive and idempotent. No data changes. Rollback: the DOWN block at the bottom.

ALTER TABLE public.awards_build_jobs
  DROP CONSTRAINT IF EXISTS awards_build_jobs_status_check;
ALTER TABLE public.awards_build_jobs
  ADD CONSTRAINT awards_build_jobs_status_check
  CHECK (status IN ('queued','running','validated','promoted','failed','superseded'));

ALTER TABLE public.awards_build_jobs
  ADD COLUMN IF NOT EXISTS superseded_by bigint REFERENCES public.awards_build_jobs(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS size_override jsonb;

COMMENT ON COLUMN public.awards_build_jobs.superseded_by IS
  'The newer job that made this one redundant. Set with status=superseded; the row is kept.';
COMMENT ON COLUMN public.awards_build_jobs.size_override IS
  'One-time plausibility override for THIS job only: {source_version, authorized_by, '
  'authorized_at, reason, expected:{recipients:[min,max], pages:[min,max]}}. Never global.';

-- DOWN (manual, only if no row uses the new status):
--   ALTER TABLE public.awards_build_jobs DROP CONSTRAINT awards_build_jobs_status_check;
--   ALTER TABLE public.awards_build_jobs ADD CONSTRAINT awards_build_jobs_status_check
--     CHECK (status IN ('queued','running','validated','promoted','failed'));
--   ALTER TABLE public.awards_build_jobs DROP COLUMN size_override,
--     DROP COLUMN superseded_at, DROP COLUMN superseded_by;
