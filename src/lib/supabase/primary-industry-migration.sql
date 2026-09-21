-- Migration: Add primary_industry column to user_notification_settings
-- Purpose: Allow users to set a primary industry that takes priority in briefing generation
-- Date: 2026-04-02

-- Add primary_industry column
-- Stores the industry label (e.g., 'Construction', 'IT Services', 'Cybersecurity')
-- This will be used to prioritize NAICS codes when generating briefings
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS primary_industry TEXT DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN user_notification_settings.primary_industry IS
'Primary industry for prioritizing NAICS codes in briefings. Values: Construction, IT Services, Cybersecurity, Professional Services, Healthcare, Logistics & Supply, Facilities & Maintenance, Training & Education';

-- Create index for filtering by primary industry (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_primary_industry
ON user_notification_settings(primary_industry)
WHERE primary_industry IS NOT NULL;
