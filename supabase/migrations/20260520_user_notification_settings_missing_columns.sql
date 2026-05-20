-- Add columns referenced by /api/app/profile (and ~9 other API routes) but
-- missing from user_notification_settings. Surfaced on May 20, 2026 during
-- fresh Google OAuth onboarding for coffleemiami@gmail.com:
--   "Could not find the 'set_aside_preferences' column of
--    'user_notification_settings' in the schema cache"
--
-- After this migration, the onboarding wizard's "Complete Setup" step
-- succeeds and the user's saved set-asides + zip make it into the DB.

ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS set_aside_preferences TEXT[] DEFAULT '{}'::TEXT[];

-- location_zip is written by the same profile API as a single-zip string
-- when the user only supplies one. Add defensively in case it's missing
-- on this project too — IF NOT EXISTS is idempotent if it already exists.
ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS location_zip TEXT;

-- Refresh PostgREST schema cache so the API sees the new columns
-- without waiting for the next auto-reload.
NOTIFY pgrst, 'reload schema';

COMMENT ON COLUMN user_notification_settings.set_aside_preferences IS
  'User-selected federal set-asides (SBA, 8(a), HUBZone, WOSB, SDVOSB, etc.). Written by /api/app/profile onboarding wizard.';
COMMENT ON COLUMN user_notification_settings.location_zip IS
  'Single-zip fallback when user supplies one zip during onboarding. Plural form lives in user_business_profiles.zip_codes for multi-zip users.';
