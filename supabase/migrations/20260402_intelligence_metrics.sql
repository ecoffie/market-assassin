-- Migration: Create intelligence measurement tables
-- Date: 2026-04-02
-- Purpose: Track metrics, logs, and feedback for 30-day intelligence test

-- 1. Intelligence Metrics (Daily KPIs)
CREATE TABLE IF NOT EXISTS intelligence_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  metric_type TEXT NOT NULL,  -- 'daily_alerts', 'weekly_alerts', 'briefings', 'unified'

  -- Volume
  emails_attempted INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  users_eligible INTEGER DEFAULT 0,
  users_skipped INTEGER DEFAULT 0,

  -- Opportunities
  opportunities_matched INTEGER DEFAULT 0,
  opportunities_total INTEGER DEFAULT 0,
  avg_match_score NUMERIC(5,2),

  -- Engagement (updated via webhook/tracking)
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  unsubscribes INTEGER DEFAULT 0,

  -- Quality
  user_feedback_positive INTEGER DEFAULT 0,
  user_feedback_negative INTEGER DEFAULT 0,

  -- Performance
  cron_duration_ms INTEGER,
  api_calls_made INTEGER DEFAULT 0,
  api_errors INTEGER DEFAULT 0,

  -- Guardrail events
  guardrail_warnings INTEGER DEFAULT 0,
  circuit_breaker_tripped BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_metrics_date_type ON intelligence_metrics(date, metric_type);
CREATE INDEX idx_metrics_date ON intelligence_metrics(date);

-- 2. Intelligence Log (Per-User Delivery Tracking)
CREATE TABLE IF NOT EXISTS intelligence_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  intelligence_type TEXT NOT NULL,  -- 'daily_alert', 'weekly_alert', 'briefing', 'recompete', 'teaming'

  -- Delivery info
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_method TEXT DEFAULT 'email',  -- 'email', 'sms', 'in-app'
  delivery_status TEXT DEFAULT 'sent',   -- 'sent', 'failed', 'bounced', 'spam'

  -- Content delivered
  items_count INTEGER DEFAULT 0,         -- Number of opportunities/items
  item_ids TEXT[] DEFAULT '{}',          -- Reference IDs (noticeIds, etc.)
  item_data JSONB,                       -- Snapshot of items (optional, for debugging)

  -- Engagement tracking
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_intelligence_log_email ON intelligence_log(user_email);
CREATE INDEX idx_intelligence_log_type ON intelligence_log(intelligence_type);
CREATE INDEX idx_intelligence_log_delivered ON intelligence_log(delivered_at);
CREATE INDEX idx_intelligence_log_status ON intelligence_log(delivery_status);

-- 3. User Feedback (Quality Signal)
CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  feedback_type TEXT NOT NULL,           -- 'helpful', 'not_helpful', 'wrong_match', 'spam', 'feature_request'

  -- Context
  intelligence_type TEXT,                -- What triggered feedback
  intelligence_log_id UUID REFERENCES intelligence_log(id),
  opportunity_id TEXT,                   -- Specific opp if applicable

  -- Feedback content
  rating INTEGER,                        -- 1-5 if star rating
  is_positive BOOLEAN,                   -- Quick classification
  comment TEXT,                          -- Optional freeform

  -- Source
  feedback_source TEXT DEFAULT 'email',  -- 'email', 'dashboard', 'survey'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_email ON user_feedback(user_email);
CREATE INDEX idx_feedback_type ON user_feedback(feedback_type);
CREATE INDEX idx_feedback_positive ON user_feedback(is_positive);
CREATE INDEX idx_feedback_created ON user_feedback(created_at);

-- 4. Guardrail Events (Circuit Breaker History)
CREATE TABLE IF NOT EXISTS guardrail_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,              -- 'warning', 'trip', 'reset', 'manual_override'

  -- Context
  cron_name TEXT,                        -- 'daily-alerts', 'briefings', etc.
  reason TEXT,                           -- Why triggered

  -- Metrics at time of event
  failure_rate NUMERIC(5,4),
  consecutive_failures INTEGER,
  total_failures INTEGER,

  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                      -- 'auto', 'manual', email of admin

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guardrail_type ON guardrail_events(event_type);
CREATE INDEX idx_guardrail_cron ON guardrail_events(cron_name);
CREATE INDEX idx_guardrail_created ON guardrail_events(created_at);

-- 5. Helper function to upsert daily metrics
CREATE OR REPLACE FUNCTION upsert_intelligence_metrics(
  p_date DATE,
  p_metric_type TEXT,
  p_data JSONB
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO intelligence_metrics (date, metric_type)
  VALUES (p_date, p_metric_type)
  ON CONFLICT (date, metric_type) DO NOTHING;

  UPDATE intelligence_metrics
  SET
    emails_attempted = COALESCE((p_data->>'emails_attempted')::INTEGER, emails_attempted),
    emails_sent = COALESCE((p_data->>'emails_sent')::INTEGER, emails_sent),
    emails_failed = COALESCE((p_data->>'emails_failed')::INTEGER, emails_failed),
    users_eligible = COALESCE((p_data->>'users_eligible')::INTEGER, users_eligible),
    users_skipped = COALESCE((p_data->>'users_skipped')::INTEGER, users_skipped),
    opportunities_matched = COALESCE((p_data->>'opportunities_matched')::INTEGER, opportunities_matched),
    opportunities_total = COALESCE((p_data->>'opportunities_total')::INTEGER, opportunities_total),
    avg_match_score = COALESCE((p_data->>'avg_match_score')::NUMERIC, avg_match_score),
    cron_duration_ms = COALESCE((p_data->>'cron_duration_ms')::INTEGER, cron_duration_ms),
    api_calls_made = COALESCE((p_data->>'api_calls_made')::INTEGER, api_calls_made),
    api_errors = COALESCE((p_data->>'api_errors')::INTEGER, api_errors),
    guardrail_warnings = COALESCE((p_data->>'guardrail_warnings')::INTEGER, guardrail_warnings),
    circuit_breaker_tripped = COALESCE((p_data->>'circuit_breaker_tripped')::BOOLEAN, circuit_breaker_tripped),
    updated_at = NOW()
  WHERE date = p_date AND metric_type = p_metric_type
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Grant access
GRANT ALL ON intelligence_metrics TO authenticated;
GRANT ALL ON intelligence_log TO authenticated;
GRANT ALL ON user_feedback TO authenticated;
GRANT ALL ON guardrail_events TO authenticated;
