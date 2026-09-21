-- User Engagement Tracking System
-- Phase 1 of Email Analytics & User Health Features
-- Created: April 19, 2026

-- Main engagement events table
-- Tracks: email opens, link clicks, page views, report generations, exports, logins
CREATE TABLE IF NOT EXISTS user_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Event classification
  event_type TEXT NOT NULL, -- 'email_open', 'link_click', 'page_view', 'report_generate', 'export', 'login', 'tool_use'
  event_source TEXT, -- 'daily_alert', 'weekly_briefing', 'pursuit_brief', 'market_assassin', 'content_reaper', etc.

  -- Event details (flexible JSON for different event types)
  metadata JSONB DEFAULT '{}',
  -- For email_open: { briefing_id, briefing_type, subject_line }
  -- For link_click: { url, link_text, position, briefing_id }
  -- For page_view: { path, referrer, session_id }
  -- For report_generate: { report_type, inputs }
  -- For tool_use: { tool_name, action, duration_ms }

  -- Tracking info
  ip_address TEXT,
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_user_engagement_email ON user_engagement(user_email);
CREATE INDEX IF NOT EXISTS idx_user_engagement_type ON user_engagement(event_type);
CREATE INDEX IF NOT EXISTS idx_user_engagement_source ON user_engagement(event_source);
CREATE INDEX IF NOT EXISTS idx_user_engagement_created ON user_engagement(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_engagement_email_date ON user_engagement(user_email, created_at DESC);

-- Email tracking tokens (for unique open/click tracking)
CREATE TABLE IF NOT EXISTS email_tracking_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL, -- Short unique token for URL
  user_email TEXT NOT NULL,
  email_type TEXT NOT NULL, -- 'daily_alert', 'weekly_briefing', 'pursuit_brief'
  email_date DATE NOT NULL,

  -- Stats
  opens INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  first_open_at TIMESTAMPTZ,
  last_open_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_email_tracking_token ON email_tracking_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_tracking_email ON email_tracking_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_email_tracking_email_type ON email_tracking_tokens(email_type, email_date);

-- Daily engagement aggregates (for dashboards)
CREATE TABLE IF NOT EXISTS engagement_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date DATE NOT NULL,
  email_type TEXT, -- NULL for overall, or 'daily_alert', 'weekly_briefing', etc.

  -- Email metrics
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  unique_opens INTEGER DEFAULT 0,
  links_clicked INTEGER DEFAULT 0,
  unique_clickers INTEGER DEFAULT 0,

  -- Engagement metrics
  page_views INTEGER DEFAULT 0,
  active_users INTEGER DEFAULT 0, -- Users with any activity
  reports_generated INTEGER DEFAULT 0,
  exports_count INTEGER DEFAULT 0,

  -- Computed rates (stored for fast queries)
  open_rate DECIMAL(5,2), -- emails_opened / emails_sent * 100
  click_rate DECIMAL(5,2), -- unique_clickers / emails_opened * 100 (CTR)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(stat_date, email_type)
);

CREATE INDEX IF NOT EXISTS idx_engagement_daily_date ON engagement_daily_stats(stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_daily_type ON engagement_daily_stats(email_type, stat_date DESC);

-- User engagement scores (computed daily for each user)
CREATE TABLE IF NOT EXISTS user_engagement_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL UNIQUE,

  -- Engagement score (0-100)
  engagement_score INTEGER DEFAULT 50,

  -- Activity counts (last 30 days)
  emails_opened_30d INTEGER DEFAULT 0,
  emails_sent_30d INTEGER DEFAULT 0,
  links_clicked_30d INTEGER DEFAULT 0,
  page_views_30d INTEGER DEFAULT 0,
  logins_30d INTEGER DEFAULT 0,
  reports_generated_30d INTEGER DEFAULT 0,

  -- Profile completeness (0-100)
  profile_completeness INTEGER DEFAULT 0,
  -- Factors: has_naics, has_agencies, has_keywords, has_geography, has_delivery_prefs

  -- Health indicators
  days_since_last_activity INTEGER,
  last_activity_at TIMESTAMPTZ,
  churn_risk TEXT DEFAULT 'low', -- 'low', 'medium', 'high', 'critical'

  -- Computed at
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_scores_email ON user_engagement_scores(user_email);
CREATE INDEX IF NOT EXISTS idx_user_scores_churn ON user_engagement_scores(churn_risk);
CREATE INDEX IF NOT EXISTS idx_user_scores_score ON user_engagement_scores(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_last_activity ON user_engagement_scores(days_since_last_activity DESC);

-- Function to compute user engagement score
CREATE OR REPLACE FUNCTION compute_engagement_score(
  p_emails_opened INTEGER,
  p_emails_sent INTEGER,
  p_links_clicked INTEGER,
  p_page_views INTEGER,
  p_logins INTEGER,
  p_reports_generated INTEGER,
  p_days_since_activity INTEGER,
  p_profile_completeness INTEGER
) RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 0;
  v_open_rate DECIMAL;
BEGIN
  -- Open rate component (max 25 points)
  IF p_emails_sent > 0 THEN
    v_open_rate := (p_emails_opened::DECIMAL / p_emails_sent::DECIMAL) * 100;
    v_score := v_score + LEAST(25, FLOOR(v_open_rate * 0.5));
  END IF;

  -- Click engagement (max 20 points)
  v_score := v_score + LEAST(20, p_links_clicked * 2);

  -- Page views (max 15 points)
  v_score := v_score + LEAST(15, p_page_views);

  -- Logins (max 10 points)
  v_score := v_score + LEAST(10, p_logins * 2);

  -- Reports generated (max 10 points)
  v_score := v_score + LEAST(10, p_reports_generated * 5);

  -- Profile completeness (max 10 points)
  v_score := v_score + FLOOR(p_profile_completeness * 0.1);

  -- Recency penalty (up to -20 points)
  IF p_days_since_activity > 30 THEN
    v_score := v_score - 20;
  ELSIF p_days_since_activity > 14 THEN
    v_score := v_score - 10;
  ELSIF p_days_since_activity > 7 THEN
    v_score := v_score - 5;
  END IF;

  -- Ensure score is 0-100
  RETURN GREATEST(0, LEAST(100, v_score));
END;
$$ LANGUAGE plpgsql;

-- Function to determine churn risk level
CREATE OR REPLACE FUNCTION get_churn_risk(
  p_engagement_score INTEGER,
  p_days_since_activity INTEGER
) RETURNS TEXT AS $$
BEGIN
  -- Critical: no activity in 21+ days OR very low engagement
  IF p_days_since_activity >= 21 OR p_engagement_score < 15 THEN
    RETURN 'critical';
  END IF;

  -- High: no activity in 14+ days OR low engagement
  IF p_days_since_activity >= 14 OR p_engagement_score < 30 THEN
    RETURN 'high';
  END IF;

  -- Medium: no activity in 7+ days OR below average engagement
  IF p_days_since_activity >= 7 OR p_engagement_score < 50 THEN
    RETURN 'medium';
  END IF;

  -- Low: active and engaged
  RETURN 'low';
END;
$$ LANGUAGE plpgsql;

-- View for quick user health overview
CREATE OR REPLACE VIEW user_health_overview AS
SELECT
  ues.user_email,
  ues.engagement_score,
  ues.churn_risk,
  ues.days_since_last_activity,
  ues.last_activity_at,
  ues.emails_opened_30d,
  ues.emails_sent_30d,
  CASE
    WHEN ues.emails_sent_30d > 0
    THEN ROUND((ues.emails_opened_30d::DECIMAL / ues.emails_sent_30d::DECIMAL) * 100, 1)
    ELSE 0
  END as open_rate_30d,
  ues.profile_completeness,
  uns.naics_codes,
  uns.briefings_enabled,
  uns.alerts_enabled
FROM user_engagement_scores ues
LEFT JOIN user_notification_settings uns ON uns.user_email = ues.user_email
ORDER BY ues.engagement_score DESC;

-- Comments for documentation
COMMENT ON TABLE user_engagement IS 'Tracks all user engagement events (opens, clicks, page views, etc.)';
COMMENT ON TABLE email_tracking_tokens IS 'Unique tokens for tracking email opens and clicks';
COMMENT ON TABLE engagement_daily_stats IS 'Daily aggregated engagement statistics for dashboards';
COMMENT ON TABLE user_engagement_scores IS 'Computed user health scores updated daily';
COMMENT ON FUNCTION compute_engagement_score IS 'Calculates 0-100 engagement score from activity metrics';
COMMENT ON FUNCTION get_churn_risk IS 'Determines churn risk level based on engagement and activity';
