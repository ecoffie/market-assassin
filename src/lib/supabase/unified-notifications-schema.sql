-- ============================================================
-- UNIFIED NOTIFICATION SETTINGS SCHEMA
-- Merges user_alert_settings + user_briefing_profile into one table
-- Run this in Supabase SQL Editor
-- Created: March 25, 2026
-- ============================================================

-- Drop old tables (no data to preserve)
DROP TABLE IF EXISTS user_alert_settings CASCADE;
DROP TABLE IF EXISTS user_briefing_profile CASCADE;

-- ============================================================
-- UNIFIED TABLE: user_notification_settings
-- Single source of truth for alerts + briefings preferences
-- ============================================================

CREATE TABLE IF NOT EXISTS user_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT UNIQUE NOT NULL,

  -- ========== SEARCH CRITERIA (shared by alerts & briefings) ==========
  naics_codes TEXT[] DEFAULT '{}',           -- NAICS codes to watch (supports prefixes like '236')
  keywords TEXT[] DEFAULT '{}',              -- Keywords for text search
  agencies TEXT[] DEFAULT '{}',              -- Target agencies
  business_type TEXT,                        -- Set-aside: 'SDVOSB', '8a', 'WOSB', 'HUBZone', etc.
  location_state TEXT,                       -- State filter (e.g., 'FL', 'VA')
  location_zip TEXT,                         -- ZIP code filter

  -- ========== BRIEFINGS-SPECIFIC ==========
  watched_companies TEXT[] DEFAULT '{}',     -- Competitor tracking
  watched_contracts TEXT[] DEFAULT '{}',     -- Specific contracts to watch

  -- Weighted scores for ranking (from search history aggregation)
  naics_weights JSONB DEFAULT '{}',          -- {"541512": 15, "541519": 8}
  agency_weights JSONB DEFAULT '{}',
  company_weights JSONB DEFAULT '{}',

  -- Aggregated profile (computed from search history)
  aggregated_profile JSONB DEFAULT '{}',

  -- ========== DELIVERY PREFERENCES ==========
  timezone TEXT DEFAULT 'America/New_York',

  -- Alerts (SAM.gov opportunity notifications)
  alerts_enabled BOOLEAN DEFAULT TRUE,
  alert_frequency TEXT DEFAULT 'daily',      -- 'daily' | 'weekly' | 'paused'
  alert_day TEXT DEFAULT 'sunday',           -- Day for weekly alerts

  -- Briefings (curated intel digest)
  briefings_enabled BOOLEAN DEFAULT TRUE,
  briefing_frequency TEXT DEFAULT 'daily',   -- 'daily' | 'weekly' | 'paused'
  preferred_delivery_hour INTEGER DEFAULT 7, -- Hour in user's timezone (0-23)

  -- SMS
  sms_enabled BOOLEAN DEFAULT FALSE,
  phone_number TEXT,                         -- E.164 format (+1...)

  -- ========== TRACKING ==========
  last_alert_sent TIMESTAMPTZ,
  last_briefing_sent TIMESTAMPTZ,
  total_alerts_sent INTEGER DEFAULT 0,
  total_briefings_sent INTEGER DEFAULT 0,

  -- Search history sync
  last_search_sync TIMESTAMPTZ,
  search_count INTEGER DEFAULT 0,

  -- ========== STATUS ==========
  is_active BOOLEAN DEFAULT TRUE,            -- Master switch

  -- ========== TIMESTAMPS ==========
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notif_settings_email ON user_notification_settings(user_email);
CREATE INDEX IF NOT EXISTS idx_notif_settings_active ON user_notification_settings(is_active);
CREATE INDEX IF NOT EXISTS idx_notif_settings_alerts ON user_notification_settings(alerts_enabled, alert_frequency);
CREATE INDEX IF NOT EXISTS idx_notif_settings_briefings ON user_notification_settings(briefings_enabled, briefing_frequency);
CREATE INDEX IF NOT EXISTS idx_notif_settings_timezone ON user_notification_settings(timezone);

-- RLS
ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_notification_settings" ON user_notification_settings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on user_notification_settings" ON user_notification_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on user_notification_settings" ON user_notification_settings
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on user_notification_settings" ON user_notification_settings
  FOR UPDATE USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_notification_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_notification_settings_updated_at ON user_notification_settings;
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON user_notification_settings
  FOR EACH ROW EXECUTE FUNCTION update_notification_settings_updated_at();

COMMENT ON TABLE user_notification_settings IS 'Unified notification preferences for daily alerts and briefings';


-- ============================================================
-- KEEP THESE TABLES (they track delivery history, not settings)
-- ============================================================
-- alert_log - Tracks every alert sent
-- briefing_log - Tracks every briefing sent
-- briefing_snapshots - Daily data snapshots
-- web_intelligence_cache - Shared web search cache
-- user_search_history - Search behavior tracking
-- briefing_subscriptions - Stripe subscription tracking


-- ============================================================
-- HELPER FUNCTION: Aggregate search history into profile
-- ============================================================

CREATE OR REPLACE FUNCTION aggregate_search_to_notification_settings(p_email TEXT)
RETURNS VOID AS $$
DECLARE
  v_naics TEXT[];
  v_agencies TEXT[];
  v_companies TEXT[];
  v_keywords TEXT[];
  v_naics_weights JSONB;
  v_agency_weights JSONB;
  v_company_weights JSONB;
  v_search_count INTEGER;
BEGIN
  -- Count total searches
  SELECT COUNT(*) INTO v_search_count
  FROM user_search_history
  WHERE user_email = p_email;

  -- Aggregate NAICS codes (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_naics, v_naics_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'naics'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Aggregate agencies (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_agencies, v_agency_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'agency'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Aggregate companies (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_companies, v_company_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'company'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Aggregate keywords (top 10)
  SELECT array_agg(search_value ORDER BY cnt DESC)
  INTO v_keywords
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'keyword'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Upsert notification settings (only update aggregated fields, not user preferences)
  INSERT INTO user_notification_settings (
    user_email,
    naics_codes, agencies, watched_companies, keywords,
    naics_weights, agency_weights, company_weights,
    search_count, last_search_sync
  )
  VALUES (
    p_email,
    COALESCE(v_naics, '{}'),
    COALESCE(v_agencies, '{}'),
    COALESCE(v_companies, '{}'),
    COALESCE(v_keywords, '{}'),
    COALESCE(v_naics_weights, '{}'),
    COALESCE(v_agency_weights, '{}'),
    COALESCE(v_company_weights, '{}'),
    v_search_count,
    NOW()
  )
  ON CONFLICT (user_email) DO UPDATE SET
    -- Only update if user hasn't manually set these (empty = auto-populate)
    naics_codes = CASE
      WHEN array_length(user_notification_settings.naics_codes, 1) IS NULL
      THEN COALESCE(v_naics, '{}')
      ELSE user_notification_settings.naics_codes
    END,
    agencies = CASE
      WHEN array_length(user_notification_settings.agencies, 1) IS NULL
      THEN COALESCE(v_agencies, '{}')
      ELSE user_notification_settings.agencies
    END,
    watched_companies = CASE
      WHEN array_length(user_notification_settings.watched_companies, 1) IS NULL
      THEN COALESCE(v_companies, '{}')
      ELSE user_notification_settings.watched_companies
    END,
    -- Always update weights and counts
    naics_weights = COALESCE(v_naics_weights, user_notification_settings.naics_weights),
    agency_weights = COALESCE(v_agency_weights, user_notification_settings.agency_weights),
    company_weights = COALESCE(v_company_weights, user_notification_settings.company_weights),
    search_count = v_search_count,
    last_search_sync = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- DONE
-- ============================================================

-- Summary:
-- 1. Dropped user_alert_settings (empty)
-- 2. Dropped user_briefing_profile (empty)
-- 3. Created user_notification_settings (unified table)
-- 4. Updated aggregate function to use new table

-- Next steps:
-- 1. Update preferences API to use user_notification_settings
-- 2. Update all cron jobs to read from user_notification_settings
