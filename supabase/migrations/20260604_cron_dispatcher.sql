-- Cron Dispatcher — Phase 1 schedule tables
-- =================================================================
-- Replaces "one vercel.json cron entry per job" (capped at 100 by
-- Vercel) with a small fixed set of dispatcher ticks that read these
-- tables and fire whatever is due. Adding a scheduled job becomes an
-- INSERT here, not a vercel.json edit. See docs/PRD-cron-dispatcher.md.
--
-- HAND-RUN in the Supabase SQL editor (this DB has no in-app DDL).

-- ── The job registry. One row per logical scheduled job. ──────────
CREATE TABLE IF NOT EXISTS cron_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      text NOT NULL UNIQUE,          -- stable identifier, e.g. 'sync-sam-opportunities-full'
  -- What to fire. route = an internal /api/... path the dispatcher fetches.
  route         text NOT NULL,                 -- e.g. '/api/cron/sync-sam-opportunities?type=full'
  cron_expr     text NOT NULL,                 -- standard 5-field cron, evaluated in UTC
  enabled       boolean NOT NULL DEFAULT true,
  -- Bookkeeping the dispatcher maintains.
  last_run_at   timestamptz,                   -- when it last FIRED (start)
  last_status   text,                          -- 'success' | 'error' | 'running' | 'timeout' | 'skipped'
  -- Overlap guard: set when a run starts, cleared when it ends. A tick
  -- skips a job whose lock is held and not stale.
  locked_at     timestamptz,
  timeout_ms    integer NOT NULL DEFAULT 60000, -- run considered stale after this (lock auto-expires)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- extra context passed to the job
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Dispatcher scans enabled jobs every tick — keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs (enabled) WHERE enabled;

-- ── Run history. One row per fire, for observability + debugging. ──
CREATE TABLE IF NOT EXISTS cron_job_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error' | 'timeout'
  duration_ms   integer,
  http_status   integer,                        -- the fired route's response status
  error         text,
  tick          text                            -- which dispatcher tick fired it ('minute'|'hour'|'day'|...)
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job ON cron_job_runs (job_name, started_at DESC);

-- updated_at trigger for cron_jobs
CREATE OR REPLACE FUNCTION cron_jobs_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cron_jobs_updated_at ON cron_jobs;
CREATE TRIGGER trg_cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW EXECUTE FUNCTION cron_jobs_touch_updated_at();

-- ── Seed: the 3 jobs migrated off vercel.json in Phase 1 (proof-of-concept).
-- These are low-risk, idempotent maintenance jobs — the load-bearing send
-- pipelines stay on native crons and migrate LAST (Phase 2). The dispatcher
-- fires these by hitting their existing routes; the job LOGIC is unchanged.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, notes) VALUES
  ('refresh-bq-rollups', '/api/cron/refresh-bq-rollups', '0 8 5 * *', 60000,
   'Monthly BQ rollup rebuild (incl. agency_office_summary). Migrated from vercel.json 2026-06-04.'),
  ('aggregate-profiles', '/api/cron/aggregate-profiles', '0 6 * * *', 60000,
   'Daily profile aggregation. Migrated from vercel.json 2026-06-04.'),
  ('health-check-email', '/api/cron/health-check?email=true', '0 16 * * *', 60000,
   'Daily API health check + email. Migrated from vercel.json 2026-06-04.')
ON CONFLICT (job_name) DO NOTHING;
