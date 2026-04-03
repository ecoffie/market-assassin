-- Create cron_logs table for tracking scheduled job executions
-- Created: April 3, 2026

CREATE TABLE IF NOT EXISTS cron_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  run_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'running', -- running, success, error
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by job name and date
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_name ON cron_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_logs_run_date ON cron_logs(run_date DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_status ON cron_logs(status);

-- Add comment
COMMENT ON TABLE cron_logs IS 'Logs for cron job executions including refresh-contracts';
