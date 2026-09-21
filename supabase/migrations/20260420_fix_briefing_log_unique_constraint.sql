-- Fix briefing_log unique constraint to include briefing_type
-- This prevents daily/weekly/pursuit briefings from colliding on the same date
--
-- MIGRATION ORDER: This file is self-contained - adds column then constraint

-- Step 1: Add briefing_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'briefing_log' AND column_name = 'briefing_type') THEN
    ALTER TABLE briefing_log
    ADD COLUMN briefing_type TEXT DEFAULT 'daily'
    CHECK (briefing_type IN ('daily', 'weekly', 'pursuit'));

    COMMENT ON COLUMN briefing_log.briefing_type IS 'Type of briefing: daily, weekly, or pursuit';
  END IF;
END $$;

-- Step 2: Drop the old unique constraint (may not exist on all envs)
ALTER TABLE briefing_log DROP CONSTRAINT IF EXISTS briefing_log_user_email_briefing_date_key;

-- Step 3: Create new unique constraint that includes briefing_type
-- This allows one daily, one weekly, and one pursuit briefing per user per date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'briefing_log_user_email_date_type_key'
  ) THEN
    ALTER TABLE briefing_log ADD CONSTRAINT briefing_log_user_email_date_type_key
      UNIQUE (user_email, briefing_date, briefing_type);
  END IF;
END $$;

-- Step 4: Create supporting indexes
CREATE INDEX IF NOT EXISTS idx_briefing_log_email_date_type
  ON briefing_log(user_email, briefing_date, briefing_type);

CREATE INDEX IF NOT EXISTS idx_briefing_log_type
  ON briefing_log(briefing_type, briefing_date);

CREATE INDEX IF NOT EXISTS idx_briefing_log_date_user_type
  ON briefing_log(briefing_date, user_email, briefing_type);

-- Add comment explaining the change
COMMENT ON CONSTRAINT briefing_log_user_email_date_type_key ON briefing_log IS
  'Allows one briefing per type per user per date (daily, weekly, pursuit can coexist)';
