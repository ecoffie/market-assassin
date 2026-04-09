-- Briefing Backup System - Automated Failsafe for 9K+ Users
-- Created: April 9, 2026

-- 1. Dead Letter Queue for failed briefings (retry up to 3 times)
CREATE TABLE IF NOT EXISTS briefing_dead_letter (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  briefing_type TEXT NOT NULL CHECK (briefing_type IN ('daily', 'weekly', 'pursuit')),
  briefing_date DATE NOT NULL,
  naics_codes JSONB,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'succeeded', 'exhausted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_dead_letter_status ON briefing_dead_letter(status, next_retry_at);
CREATE INDEX idx_dead_letter_date ON briefing_dead_letter(briefing_date, briefing_type);

-- 2. System Health Log - Track daily health metrics
CREATE TABLE IF NOT EXISTS briefing_system_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  check_date DATE NOT NULL,
  check_time TIMESTAMPTZ DEFAULT NOW(),
  briefing_type TEXT NOT NULL,

  -- Metrics
  templates_available INTEGER DEFAULT 0,
  templates_expected INTEGER DEFAULT 0,
  users_eligible INTEGER DEFAULT 0,
  users_sent INTEGER DEFAULT 0,
  users_failed INTEGER DEFAULT 0,
  users_skipped INTEGER DEFAULT 0,
  users_no_template INTEGER DEFAULT 0,

  -- Health Score (0-100)
  health_score INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN users_eligible = 0 THEN 100
      ELSE GREATEST(0, LEAST(100,
        (users_sent::NUMERIC / NULLIF(users_eligible, 0)::NUMERIC * 100)::INTEGER
      ))
    END
  ) STORED,

  -- Status
  is_healthy BOOLEAN GENERATED ALWAYS AS (
    users_failed < (users_eligible * 0.05) -- <5% failure rate
    AND templates_available >= templates_expected * 0.8 -- >80% templates
  ) STORED,

  -- Alerts
  alert_sent BOOLEAN DEFAULT FALSE,
  alert_level TEXT CHECK (alert_level IN ('info', 'warning', 'critical')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_health_date_type ON briefing_system_health(check_date, briefing_type, check_time);

-- 3. Add retry columns to briefing_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'briefing_log' AND column_name = 'retry_count') THEN
    ALTER TABLE briefing_log ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'briefing_log' AND column_name = 'is_retry') THEN
    ALTER TABLE briefing_log ADD COLUMN is_retry BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'briefing_log' AND column_name = 'original_failure_id') THEN
    ALTER TABLE briefing_log ADD COLUMN original_failure_id UUID REFERENCES briefing_dead_letter(id);
  END IF;
END $$;

-- 4. Function to queue failed briefing for retry
CREATE OR REPLACE FUNCTION queue_briefing_retry(
  p_user_email TEXT,
  p_briefing_type TEXT,
  p_briefing_date DATE,
  p_naics_codes JSONB,
  p_failure_reason TEXT
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
BEGIN
  -- Check if already queued
  SELECT id INTO v_existing
  FROM briefing_dead_letter
  WHERE user_email = p_user_email
    AND briefing_type = p_briefing_type
    AND briefing_date = p_briefing_date
    AND status IN ('pending', 'retrying');

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Queue new retry
  INSERT INTO briefing_dead_letter (
    user_email, briefing_type, briefing_date, naics_codes,
    failure_reason, next_retry_at
  ) VALUES (
    p_user_email, p_briefing_type, p_briefing_date, p_naics_codes,
    p_failure_reason, NOW() + INTERVAL '15 minutes'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Function to get retry candidates
CREATE OR REPLACE FUNCTION get_briefing_retries(
  p_briefing_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
  id UUID,
  user_email TEXT,
  briefing_type TEXT,
  briefing_date DATE,
  naics_codes JSONB,
  retry_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dl.id,
    dl.user_email,
    dl.briefing_type,
    dl.briefing_date,
    dl.naics_codes,
    dl.retry_count
  FROM briefing_dead_letter dl
  WHERE dl.status = 'pending'
    AND dl.next_retry_at <= NOW()
    AND dl.retry_count < dl.max_retries
    AND (p_briefing_type IS NULL OR dl.briefing_type = p_briefing_type)
  ORDER BY dl.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 6. Function to mark retry as complete
CREATE OR REPLACE FUNCTION complete_briefing_retry(
  p_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF p_success THEN
    UPDATE briefing_dead_letter
    SET status = 'succeeded',
        resolved_at = NOW()
    WHERE id = p_id;
  ELSE
    UPDATE briefing_dead_letter
    SET retry_count = retry_count + 1,
        last_retry_at = NOW(),
        next_retry_at = NOW() + (INTERVAL '15 minutes' * POWER(2, retry_count)),
        failure_reason = COALESCE(p_error, failure_reason),
        status = CASE
          WHEN retry_count + 1 >= max_retries THEN 'exhausted'
          ELSE 'pending'
        END
    WHERE id = p_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 7. View for monitoring dashboard
CREATE OR REPLACE VIEW briefing_health_summary AS
SELECT
  check_date,
  briefing_type,
  health_score,
  is_healthy,
  users_eligible,
  users_sent,
  users_failed,
  users_no_template,
  templates_available,
  alert_level
FROM briefing_system_health
WHERE check_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY check_date DESC, briefing_type;

-- 8. View for dead letter summary
CREATE OR REPLACE VIEW briefing_retry_summary AS
SELECT
  briefing_type,
  status,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries
FROM briefing_dead_letter
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY briefing_type, status
ORDER BY briefing_type, status;

COMMENT ON TABLE briefing_dead_letter IS 'Dead letter queue for failed briefings - automatic retry up to 3 times';
COMMENT ON TABLE briefing_system_health IS 'Daily health metrics and alerting for briefing system';
