-- Fix alert_log unique constraint to include alert_type
-- This prevents daily/weekly alerts from colliding on the same date
--
-- MIGRATION: Self-contained - adds column check then constraint

-- Step 1: Ensure alert_type column exists (added in alerts-schema-update.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'alert_log' AND column_name = 'alert_type') THEN
    ALTER TABLE alert_log
    ADD COLUMN alert_type TEXT DEFAULT 'daily'
    CHECK (alert_type IN ('daily', 'weekly'));

    COMMENT ON COLUMN alert_log.alert_type IS 'Type of alert: daily or weekly';
  END IF;
END $$;

-- Step 2: Drop the old unique constraint (may not exist on all envs)
ALTER TABLE alert_log DROP CONSTRAINT IF EXISTS alert_log_user_email_alert_date_key;

-- Step 3: Create new unique constraint that includes alert_type
-- This allows one daily and one weekly alert per user per date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alert_log_user_email_date_type_key'
  ) THEN
    ALTER TABLE alert_log ADD CONSTRAINT alert_log_user_email_date_type_key
      UNIQUE (user_email, alert_date, alert_type);
  END IF;
END $$;

-- Step 4: Create supporting indexes
CREATE INDEX IF NOT EXISTS idx_alert_log_email_date_type
  ON alert_log(user_email, alert_date, alert_type);

CREATE INDEX IF NOT EXISTS idx_alert_log_type
  ON alert_log(alert_type, alert_date);

-- Add comment explaining the change
COMMENT ON CONSTRAINT alert_log_user_email_date_type_key ON alert_log IS
  'Allows one alert per type per user per date (daily, weekly can coexist)';
