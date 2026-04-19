-- Migration: Tool Errors and AI Health Monitoring
-- Date: 2026-04-19
-- Purpose: Track errors across all AI-powered tools for monitoring dashboard

-- 1. Tool Errors Table (Per-Error Tracking)
CREATE TABLE IF NOT EXISTS tool_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tool identification
  tool_name TEXT NOT NULL,              -- 'content_reaper', 'code_suggestions', 'briefings', 'market_scanner'
  error_type TEXT NOT NULL,             -- 'ai_timeout', 'ai_rate_limit', 'ai_token_limit', 'api_error', 'validation', 'internal'

  -- Context
  user_email TEXT,                      -- Who triggered (null for cron jobs)
  request_path TEXT,                    -- API endpoint
  request_params JSONB,                 -- Sanitized params (no secrets)

  -- Error details
  error_message TEXT NOT NULL,
  error_stack TEXT,                     -- Stack trace (for debugging)

  -- AI Provider info (if applicable)
  ai_provider TEXT,                     -- 'groq', 'openai', 'anthropic'
  ai_model TEXT,                        -- 'llama-3.3-70b', 'gpt-4', etc.
  tokens_used INTEGER,                  -- If available

  -- Resolution
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,

  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_errors_tool ON tool_errors(tool_name);
CREATE INDEX idx_tool_errors_type ON tool_errors(error_type);
CREATE INDEX idx_tool_errors_created ON tool_errors(created_at);
CREATE INDEX idx_tool_errors_unresolved ON tool_errors(is_resolved) WHERE is_resolved = false;
CREATE INDEX idx_tool_errors_email ON tool_errors(user_email);

-- 2. Tool Health Metrics (Daily Aggregates)
CREATE TABLE IF NOT EXISTS tool_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  tool_name TEXT NOT NULL,

  -- Request counts
  requests_total INTEGER DEFAULT 0,
  requests_success INTEGER DEFAULT 0,
  requests_failed INTEGER DEFAULT 0,

  -- AI-specific
  ai_calls INTEGER DEFAULT 0,
  ai_errors INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  avg_latency_ms INTEGER,

  -- Error breakdown
  errors_ai_timeout INTEGER DEFAULT 0,
  errors_ai_rate_limit INTEGER DEFAULT 0,
  errors_ai_token_limit INTEGER DEFAULT 0,
  errors_api INTEGER DEFAULT 0,
  errors_validation INTEGER DEFAULT 0,
  errors_internal INTEGER DEFAULT 0,

  -- Unique users affected
  unique_users_affected INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_tool_health_date_tool ON tool_health_metrics(date, tool_name);
CREATE INDEX idx_tool_health_date ON tool_health_metrics(date);

-- 3. API Provider Status (Real-time health checks)
CREATE TABLE IF NOT EXISTS api_provider_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,               -- 'groq', 'openai', 'sam_gov', 'usaspending'

  -- Status
  status TEXT DEFAULT 'unknown',        -- 'healthy', 'degraded', 'down', 'unknown'
  last_check_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,

  -- Performance
  avg_latency_ms INTEGER,
  success_rate_24h NUMERIC(5,2),

  -- Limits
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMPTZ,
  tokens_remaining INTEGER,             -- For AI providers with token limits

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_provider_status_provider ON api_provider_status(provider);

-- 4. Helper function to log tool errors
CREATE OR REPLACE FUNCTION log_tool_error(
  p_tool_name TEXT,
  p_error_type TEXT,
  p_error_message TEXT,
  p_user_email TEXT DEFAULT NULL,
  p_request_path TEXT DEFAULT NULL,
  p_request_params JSONB DEFAULT NULL,
  p_error_stack TEXT DEFAULT NULL,
  p_ai_provider TEXT DEFAULT NULL,
  p_ai_model TEXT DEFAULT NULL,
  p_tokens_used INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_date DATE := CURRENT_DATE;
BEGIN
  -- Insert error record
  INSERT INTO tool_errors (
    tool_name, error_type, error_message, user_email, request_path,
    request_params, error_stack, ai_provider, ai_model, tokens_used
  ) VALUES (
    p_tool_name, p_error_type, p_error_message, p_user_email, p_request_path,
    p_request_params, p_error_stack, p_ai_provider, p_ai_model, p_tokens_used
  ) RETURNING id INTO v_id;

  -- Update daily metrics
  INSERT INTO tool_health_metrics (date, tool_name, requests_failed)
  VALUES (v_date, p_tool_name, 1)
  ON CONFLICT (date, tool_name) DO UPDATE SET
    requests_failed = tool_health_metrics.requests_failed + 1,
    updated_at = NOW();

  -- Increment specific error type
  EXECUTE format(
    'UPDATE tool_health_metrics SET errors_%s = COALESCE(errors_%s, 0) + 1 WHERE date = $1 AND tool_name = $2',
    p_error_type, p_error_type
  ) USING v_date, p_tool_name;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Helper function to record successful request
CREATE OR REPLACE FUNCTION record_tool_success(
  p_tool_name TEXT,
  p_latency_ms INTEGER DEFAULT NULL,
  p_tokens_used INTEGER DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_date DATE := CURRENT_DATE;
BEGIN
  INSERT INTO tool_health_metrics (date, tool_name, requests_total, requests_success, tokens_used)
  VALUES (v_date, p_tool_name, 1, 1, COALESCE(p_tokens_used, 0))
  ON CONFLICT (date, tool_name) DO UPDATE SET
    requests_total = tool_health_metrics.requests_total + 1,
    requests_success = tool_health_metrics.requests_success + 1,
    tokens_used = tool_health_metrics.tokens_used + COALESCE(p_tokens_used, 0),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 6. Initialize provider status records
INSERT INTO api_provider_status (provider, status) VALUES
  ('groq', 'unknown'),
  ('openai', 'unknown'),
  ('sam_gov', 'unknown'),
  ('usaspending', 'unknown'),
  ('grants_gov', 'unknown')
ON CONFLICT DO NOTHING;

-- Grant access
GRANT ALL ON tool_errors TO authenticated;
GRANT ALL ON tool_health_metrics TO authenticated;
GRANT ALL ON api_provider_status TO authenticated;
