-- ============================================================
-- ALERTS SCHEMA UPDATE - March 23, 2026
-- Adds timezone, retry_count, alert_type columns
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add timezone column to user_alert_settings
ALTER TABLE user_alert_settings
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

COMMENT ON COLUMN user_alert_settings.timezone IS 'User timezone for delivery time (e.g., America/New_York, America/Los_Angeles)';

-- Create index for timezone-based queries
CREATE INDEX IF NOT EXISTS idx_alert_settings_timezone ON user_alert_settings(timezone);

-- Add retry_count and alert_type to alert_log
ALTER TABLE alert_log
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

ALTER TABLE alert_log
ADD COLUMN IF NOT EXISTS alert_type TEXT DEFAULT 'daily';

COMMENT ON COLUMN alert_log.retry_count IS 'Number of retry attempts for failed deliveries (max 3)';
COMMENT ON COLUMN alert_log.alert_type IS 'Type of alert: daily or weekly';

-- Create index for retry queries
CREATE INDEX IF NOT EXISTS idx_alert_log_retry ON alert_log(delivery_status, retry_count)
WHERE delivery_status = 'failed' AND retry_count < 3;

-- ============================================================
-- SET ALL EXISTING USERS TO DAILY ALERTS (free for everyone)
-- ============================================================

-- Update all active users to daily frequency (removing paywall)
UPDATE user_alert_settings
SET alert_frequency = 'daily'
WHERE is_active = true AND alert_frequency = 'weekly';

-- Log how many users were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM user_alert_settings
  WHERE alert_frequency = 'daily' AND is_active = true;

  RAISE NOTICE 'Total daily alert users: %', updated_count;
END $$;

-- ============================================================
-- DONE
-- ============================================================

-- Summary of changes:
-- 1. Added timezone column to user_alert_settings (default: America/New_York)
-- 2. Added retry_count to alert_log (for retry logic)
-- 3. Added alert_type to alert_log (daily vs weekly)
-- 4. Converted all weekly users to daily (free for everyone)
-- 5. Added indexes for efficient queries
