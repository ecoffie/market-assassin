-- Signup Events Table for Enterprise Health Monitoring
-- Created: May 14, 2026
-- Purpose: Track signup funnel events for monitoring, analytics, and alerting

-- ============================================================
-- SIGNUP EVENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS signup_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identification
  event_type TEXT NOT NULL,  -- signup_started, step_completed, signup_completed, signup_failed
  step TEXT,                 -- email, business_description, industries, agencies, geography, delivery
  status TEXT NOT NULL DEFAULT 'success',  -- success, failed, skipped

  -- User context
  session_id TEXT,           -- Anonymous session tracking
  user_email TEXT,           -- Email (when available)
  ip_address TEXT,           -- For fraud detection
  user_agent TEXT,           -- Browser info

  -- Error tracking
  error_type TEXT,           -- auth_failed, validation_failed, api_error, timeout
  error_message TEXT,        -- Detailed error message

  -- Funnel analytics
  source TEXT,               -- free-signup, paid_existing, opportunity-hunter-free
  referrer TEXT,             -- Where they came from

  -- Metadata
  metadata JSONB DEFAULT '{}',  -- Additional context
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_signup_events_created_at ON signup_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_events_event_type ON signup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_signup_events_status ON signup_events(status);
CREATE INDEX IF NOT EXISTS idx_signup_events_user_email ON signup_events(user_email);
CREATE INDEX IF NOT EXISTS idx_signup_events_session_id ON signup_events(session_id);
CREATE INDEX IF NOT EXISTS idx_signup_events_step ON signup_events(step);

-- For time-series queries (last 24h, last 7d, etc.)
CREATE INDEX IF NOT EXISTS idx_signup_events_type_created
  ON signup_events(event_type, created_at DESC);

-- For error analysis
CREATE INDEX IF NOT EXISTS idx_signup_events_errors
  ON signup_events(error_type, created_at DESC)
  WHERE status = 'failed';

-- ============================================================
-- SIGNUP HEALTH METRICS (Daily Aggregates)
-- ============================================================
CREATE TABLE IF NOT EXISTS signup_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Time period
  metric_date DATE NOT NULL,

  -- Funnel metrics
  signups_attempted INT NOT NULL DEFAULT 0,
  signups_completed INT NOT NULL DEFAULT 0,
  signups_failed INT NOT NULL DEFAULT 0,

  -- Step metrics (JSON for flexibility)
  step_metrics JSONB DEFAULT '{}',  -- { "email": { "started": 100, "completed": 95 }, ... }

  -- Error breakdown
  errors_by_type JSONB DEFAULT '{}',  -- { "auth_failed": 5, "validation": 2 }

  -- Health score
  success_rate DECIMAL(5,2),  -- 0-100
  health_score INT,           -- 0-100
  health_status TEXT,         -- healthy, degraded, critical

  -- Source breakdown
  signups_by_source JSONB DEFAULT '{}',  -- { "free-signup": 50, "paid_existing": 10 }

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_signup_health_date UNIQUE (metric_date)
);

CREATE INDEX IF NOT EXISTS idx_signup_health_date ON signup_health_metrics(metric_date DESC);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to log signup event (for easy API use)
CREATE OR REPLACE FUNCTION log_signup_event(
  p_event_type TEXT,
  p_step TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'success',
  p_session_id TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_referrer TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO signup_events (
    event_type, step, status, session_id, user_email,
    error_type, error_message, source, referrer, metadata
  ) VALUES (
    p_event_type, p_step, p_status, p_session_id, p_user_email,
    p_error_type, p_error_message, p_source, p_referrer, p_metadata
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to aggregate daily metrics (run nightly)
CREATE OR REPLACE FUNCTION aggregate_signup_metrics(p_date DATE DEFAULT CURRENT_DATE - 1)
RETURNS void AS $$
DECLARE
  v_attempted INT;
  v_completed INT;
  v_failed INT;
  v_success_rate DECIMAL(5,2);
  v_errors JSONB;
  v_steps JSONB;
  v_sources JSONB;
BEGIN
  -- Count events for the day
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'signup_started'),
    COUNT(*) FILTER (WHERE event_type = 'signup_completed'),
    COUNT(*) FILTER (WHERE status = 'failed')
  INTO v_attempted, v_completed, v_failed
  FROM signup_events
  WHERE created_at >= p_date
    AND created_at < p_date + INTERVAL '1 day';

  -- Calculate success rate
  v_success_rate := CASE
    WHEN v_attempted > 0 THEN ROUND((v_completed::DECIMAL / v_attempted) * 100, 2)
    ELSE 100
  END;

  -- Aggregate errors by type
  SELECT jsonb_object_agg(error_type, cnt)
  INTO v_errors
  FROM (
    SELECT error_type, COUNT(*) as cnt
    FROM signup_events
    WHERE created_at >= p_date
      AND created_at < p_date + INTERVAL '1 day'
      AND error_type IS NOT NULL
    GROUP BY error_type
  ) sub;

  -- Aggregate by source
  SELECT jsonb_object_agg(source, cnt)
  INTO v_sources
  FROM (
    SELECT COALESCE(source, 'unknown') as source, COUNT(*) as cnt
    FROM signup_events
    WHERE created_at >= p_date
      AND created_at < p_date + INTERVAL '1 day'
      AND event_type = 'signup_completed'
    GROUP BY source
  ) sub;

  -- Aggregate step metrics
  SELECT jsonb_object_agg(step, jsonb_build_object(
    'started', started,
    'completed', completed
  ))
  INTO v_steps
  FROM (
    SELECT
      step,
      COUNT(*) FILTER (WHERE event_type = 'step_started') as started,
      COUNT(*) FILTER (WHERE event_type = 'step_completed') as completed
    FROM signup_events
    WHERE created_at >= p_date
      AND created_at < p_date + INTERVAL '1 day'
      AND step IS NOT NULL
    GROUP BY step
  ) sub;

  -- Upsert daily metrics
  INSERT INTO signup_health_metrics (
    metric_date, signups_attempted, signups_completed, signups_failed,
    success_rate, step_metrics, errors_by_type, signups_by_source,
    health_score, health_status
  ) VALUES (
    p_date, v_attempted, v_completed, v_failed,
    v_success_rate, COALESCE(v_steps, '{}'), COALESCE(v_errors, '{}'), COALESCE(v_sources, '{}'),
    CASE
      WHEN v_success_rate >= 95 THEN 100
      WHEN v_success_rate >= 80 THEN 80
      WHEN v_success_rate >= 50 THEN 50
      ELSE 20
    END,
    CASE
      WHEN v_success_rate >= 80 THEN 'healthy'
      WHEN v_success_rate >= 50 THEN 'degraded'
      ELSE 'critical'
    END
  )
  ON CONFLICT (metric_date)
  DO UPDATE SET
    signups_attempted = EXCLUDED.signups_attempted,
    signups_completed = EXCLUDED.signups_completed,
    signups_failed = EXCLUDED.signups_failed,
    success_rate = EXCLUDED.success_rate,
    step_metrics = EXCLUDED.step_metrics,
    errors_by_type = EXCLUDED.errors_by_type,
    signups_by_source = EXCLUDED.signups_by_source,
    health_score = EXCLUDED.health_score,
    health_status = EXCLUDED.health_status,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE signup_events IS 'Tracks individual signup funnel events for monitoring and analytics';
COMMENT ON TABLE signup_health_metrics IS 'Daily aggregated signup health metrics';
COMMENT ON FUNCTION log_signup_event IS 'Helper function to log signup events from API';
COMMENT ON FUNCTION aggregate_signup_metrics IS 'Aggregates daily signup metrics (run nightly)';
