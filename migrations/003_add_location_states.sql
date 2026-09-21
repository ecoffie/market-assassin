-- Migration: Add location_states column for multi-state selection
-- Date: 2026-03-31
-- Description: Adds support for selecting multiple states in alert preferences

-- Add location_states column (JSONB array of state codes)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS location_states JSONB DEFAULT '[]'::jsonb;

-- Create index for state lookups
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_location_states
ON user_notification_settings USING GIN (location_states);

-- Comment for documentation
COMMENT ON COLUMN user_notification_settings.location_states IS 'Array of state codes for multi-state search, e.g., ["FL", "GA", "AL"]';

-- Migrate existing single location_state to location_states array
UPDATE user_notification_settings
SET location_states = jsonb_build_array(location_state)
WHERE location_state IS NOT NULL
  AND location_state != ''
  AND (location_states IS NULL OR location_states = '[]'::jsonb);
