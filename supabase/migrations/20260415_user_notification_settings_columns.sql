-- =============================================================================
-- ADD MISSING COLUMNS TO user_notification_settings
-- =============================================================================
-- The preferences API was writing to columns that don't exist.
-- This migration adds them.
-- Created: April 15, 2026
-- =============================================================================

-- Multi-state support (array of state codes like ['FL', 'GA', 'VA'])
ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS location_states TEXT[] DEFAULT '{}';

-- Hash of NAICS profile for template matching
ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS naics_profile_hash TEXT;

-- When the profile was last updated (separate from updated_at for tracking)
ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;

-- Primary industry label (e.g., 'Construction', 'IT Services')
ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS primary_industry TEXT;

-- Index for template matching by hash
CREATE INDEX IF NOT EXISTS idx_notif_settings_naics_hash
  ON user_notification_settings(naics_profile_hash);

-- =============================================================================
-- DONE
-- =============================================================================
-- Run this in Supabase SQL Editor, then preferences will save correctly.
