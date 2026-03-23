-- ============================================================
-- KEYWORDS SCHEMA UPDATE - March 23, 2026
-- Adds keywords column for expanded search
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add keywords column to user_alert_settings
ALTER TABLE user_alert_settings
ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

COMMENT ON COLUMN user_alert_settings.keywords IS 'Search keywords to catch mislabeled opportunities (searches title/description)';

-- ============================================================
-- DONE
-- ============================================================
