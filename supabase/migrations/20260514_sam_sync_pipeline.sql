-- SAM.gov Resumable Sync Pipeline
-- Adds checkpoint tracking for resumable syncs and watchdog monitoring
-- Created: May 14, 2026

-- Add checkpoint columns to sam_sync_runs
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS sync_type TEXT DEFAULT 'full';
  -- 'full' = complete 30-day sync
  -- 'resume' = continuing from failed sync
  -- 'delta' = only recent changes (6 hours)
  -- 'recovery' = watchdog-triggered recovery

ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS last_successful_offset INTEGER DEFAULT 0;
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS total_available INTEGER DEFAULT 0;
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS failed_offsets INTEGER[] DEFAULT '{}';
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES sam_sync_runs(id);

-- Index for finding incomplete runs to resume
CREATE INDEX IF NOT EXISTS idx_sam_sync_runs_resumable
  ON sam_sync_runs(status, started_at)
  WHERE status IN ('running', 'failed', 'partial');

-- Add 'partial' status for runs that got some data but not all
-- Update existing status check constraint if any
COMMENT ON COLUMN sam_sync_runs.status IS 'running, completed, completed_with_errors, partial, failed';

-- SAM Sync Health table for watchdog monitoring
CREATE TABLE IF NOT EXISTS sam_sync_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at TIMESTAMPTZ DEFAULT NOW(),

  -- Cache status
  cache_record_count INTEGER,
  cache_active_count INTEGER,
  cache_newest_synced_at TIMESTAMPTZ,
  cache_age_hours DECIMAL(10,2),

  -- Recent sync performance
  last_successful_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  consecutive_failures INTEGER DEFAULT 0,

  -- Health score (0-100)
  health_score INTEGER,
  health_status TEXT, -- 'healthy', 'warning', 'critical'

  -- Actions taken
  action_taken TEXT, -- 'none', 'alert_sent', 'recovery_triggered'
  recovery_run_id UUID REFERENCES sam_sync_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_sam_sync_health_checked
  ON sam_sync_health(checked_at DESC);

-- Enable RLS
ALTER TABLE sam_sync_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access sam_sync_health" ON sam_sync_health
  FOR ALL USING (auth.role() = 'service_role');

-- Function to get current cache health
CREATE OR REPLACE FUNCTION get_sam_cache_health()
RETURNS TABLE (
  record_count INTEGER,
  active_count INTEGER,
  newest_synced_at TIMESTAMPTZ,
  cache_age_hours DECIMAL,
  last_successful_sync TIMESTAMPTZ,
  consecutive_failures INTEGER,
  health_score INTEGER,
  health_status TEXT
) AS $$
DECLARE
  v_record_count INTEGER;
  v_active_count INTEGER;
  v_newest_synced_at TIMESTAMPTZ;
  v_cache_age_hours DECIMAL;
  v_last_success TIMESTAMPTZ;
  v_consecutive_failures INTEGER;
  v_health_score INTEGER;
  v_health_status TEXT;
BEGIN
  -- Get cache stats
  SELECT COUNT(*), COUNT(*) FILTER (WHERE active = true), MAX(synced_at)
  INTO v_record_count, v_active_count, v_newest_synced_at
  FROM sam_opportunities;

  -- Calculate cache age
  v_cache_age_hours := EXTRACT(EPOCH FROM (NOW() - v_newest_synced_at)) / 3600.0;

  -- Get last successful sync
  SELECT completed_at INTO v_last_success
  FROM sam_sync_runs
  WHERE status IN ('completed', 'completed_with_errors')
  ORDER BY completed_at DESC
  LIMIT 1;

  -- Count consecutive failures
  SELECT COUNT(*) INTO v_consecutive_failures
  FROM (
    SELECT status FROM sam_sync_runs
    ORDER BY started_at DESC
    LIMIT 10
  ) recent
  WHERE status = 'failed';

  -- Calculate health score (0-100)
  v_health_score := 100;

  -- Deduct for cache age
  IF v_cache_age_hours > 48 THEN
    v_health_score := v_health_score - 50;
  ELSIF v_cache_age_hours > 24 THEN
    v_health_score := v_health_score - 25;
  ELSIF v_cache_age_hours > 12 THEN
    v_health_score := v_health_score - 10;
  END IF;

  -- Deduct for consecutive failures
  v_health_score := v_health_score - (v_consecutive_failures * 10);

  -- Deduct for low record count
  IF v_active_count < 10000 THEN
    v_health_score := v_health_score - 20;
  END IF;

  -- Clamp to 0-100
  v_health_score := GREATEST(0, LEAST(100, v_health_score));

  -- Determine status
  IF v_health_score >= 80 THEN
    v_health_status := 'healthy';
  ELSIF v_health_score >= 50 THEN
    v_health_status := 'warning';
  ELSE
    v_health_status := 'critical';
  END IF;

  RETURN QUERY SELECT
    v_record_count,
    v_active_count,
    v_newest_synced_at,
    v_cache_age_hours,
    v_last_success,
    v_consecutive_failures,
    v_health_score,
    v_health_status;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sam_sync_health IS 'Watchdog health checks for SAM.gov sync pipeline';
COMMENT ON FUNCTION get_sam_cache_health IS 'Returns current SAM cache health metrics';
