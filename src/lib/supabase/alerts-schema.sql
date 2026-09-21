-- ============================================================
-- SAVED SEARCH ALERTS SCHEMA
-- For Market Assassin Premium weekly alerts
-- Run this in Supabase SQL Editor
-- ============================================================

-- We'll leverage the existing user_briefing_profile table for profile data
-- and add a new table specifically for alert tracking

-- Table: user_alert_settings
-- Tracks alert preferences and delivery status for MA Premium users
CREATE TABLE IF NOT EXISTS user_alert_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT UNIQUE NOT NULL,

  -- Alert profile (from MA report inputs)
  naics_codes TEXT[] DEFAULT '{}',
  business_type TEXT, -- 'SDVOSB', '8a', 'WOSB', 'HUBZone', etc.
  target_agencies TEXT[] DEFAULT '{}',
  location_state TEXT,
  location_zip TEXT,

  -- Alert preferences
  alert_frequency TEXT DEFAULT 'weekly', -- 'weekly' | 'paused'
  alert_day TEXT DEFAULT 'sunday', -- Day of week for weekly alerts

  -- Tracking
  last_alert_sent TIMESTAMPTZ,
  last_alert_count INTEGER DEFAULT 0,
  total_alerts_sent INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_settings_email ON user_alert_settings(user_email);
CREATE INDEX IF NOT EXISTS idx_alert_settings_active ON user_alert_settings(is_active);
CREATE INDEX IF NOT EXISTS idx_alert_settings_frequency ON user_alert_settings(alert_frequency);

-- RLS
ALTER TABLE user_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_alert_settings" ON user_alert_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on user_alert_settings" ON user_alert_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on user_alert_settings" ON user_alert_settings
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on user_alert_settings" ON user_alert_settings
  FOR UPDATE USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_alert_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_alert_settings_updated_at ON user_alert_settings;
CREATE TRIGGER update_alert_settings_updated_at
  BEFORE UPDATE ON user_alert_settings
  FOR EACH ROW EXECUTE FUNCTION update_alert_settings_updated_at();

COMMENT ON TABLE user_alert_settings IS 'Alert preferences for MA Premium users - weekly opportunity alerts';


-- Table: alert_log
-- Tracks every alert sent (for analytics)
CREATE TABLE IF NOT EXISTS alert_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  alert_date DATE NOT NULL,
  alert_type TEXT DEFAULT 'daily' CHECK (alert_type IN ('daily', 'weekly')),

  -- Content
  opportunities_count INTEGER DEFAULT 0,
  opportunities_data JSONB, -- Summary of opportunities included

  -- Delivery
  sent_at TIMESTAMPTZ,
  delivery_status TEXT DEFAULT 'pending', -- 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed'
  retry_count INTEGER DEFAULT 0,

  -- Engagement
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  upgraded_to_briefings BOOLEAN DEFAULT FALSE,

  -- Error handling
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_email, alert_date, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_alert_log_email ON alert_log(user_email);
CREATE INDEX IF NOT EXISTS idx_alert_log_date ON alert_log(alert_date DESC);
CREATE INDEX IF NOT EXISTS idx_alert_log_status ON alert_log(delivery_status);
CREATE INDEX IF NOT EXISTS idx_alert_log_email_date_type ON alert_log(user_email, alert_date, alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_log_type ON alert_log(alert_type, alert_date);

-- RLS
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alert_log" ON alert_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on alert_log" ON alert_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on alert_log" ON alert_log
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on alert_log" ON alert_log
  FOR UPDATE USING (true);

COMMENT ON TABLE alert_log IS 'Delivery log for weekly opportunity alerts';


-- ============================================================
-- DONE
-- ============================================================

-- Summary of tables created:
-- 1. user_alert_settings - Alert preferences per MA Premium user
-- 2. alert_log - Delivery tracking for alerts

-- To grant alerts to a user after MA Premium purchase:
-- INSERT INTO user_alert_settings (user_email, naics_codes, business_type, target_agencies)
-- VALUES ('user@example.com', ARRAY['541511', '541512'], 'SDVOSB', ARRAY['DoD', 'VA']);
