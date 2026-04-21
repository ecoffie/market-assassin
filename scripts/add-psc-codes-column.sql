-- Add psc_codes column to user_notification_settings
-- This column was referenced in code but never created

ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS psc_codes TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add comment for documentation
COMMENT ON COLUMN user_notification_settings.psc_codes IS 'PSC codes for opportunity matching (auto-derived from NAICS via crosswalk)';
