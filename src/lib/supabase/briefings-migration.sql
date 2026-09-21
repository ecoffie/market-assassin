-- ============================================================
-- DAILY BRIEFINGS MIGRATION
-- Run this in Supabase SQL Editor to fix missing columns
-- ============================================================

-- 1. Add aggregated_profile and preferences to user_briefing_profile
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS aggregated_profile JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';

-- 2. Rename snapshot_data to raw_data in briefing_snapshots (if exists)
-- First check if column needs renaming
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'briefing_snapshots' AND column_name = 'snapshot_data'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'briefing_snapshots' AND column_name = 'raw_data'
  ) THEN
    ALTER TABLE briefing_snapshots RENAME COLUMN snapshot_data TO raw_data;
  END IF;
END $$;

-- 3. Add raw_data if briefing_snapshots exists but has neither column
ALTER TABLE briefing_snapshots
  ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Verify: Show current columns
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('user_briefing_profile', 'briefing_snapshots')
ORDER BY table_name, ordinal_position;
