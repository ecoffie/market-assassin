-- Migration: Add treatment_type column for paid status alignment
-- Date: 2026-04-28
-- Purpose: Restructure user treatment based on paid status
--   - treatment_type = 'briefings' for paid customers
--   - treatment_type = 'alerts' for free users
--   - Deprecate experiment_cohort (keep for historical reference)

-- Add treatment_type column
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS treatment_type TEXT DEFAULT 'alerts';

-- Add index for treatment_type queries
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_treatment_type
ON user_notification_settings(treatment_type);

-- Add comment explaining the field
COMMENT ON COLUMN user_notification_settings.treatment_type IS
'User treatment tier: ''briefings'' (paid - full MI access) or ''alerts'' (free - daily alerts only). Replaces experiment_cohort for production use.';

-- Add comment deprecating experiment_cohort
COMMENT ON COLUMN user_notification_settings.experiment_cohort IS
'DEPRECATED: Kept for historical reference only. Use treatment_type for current treatment assignment.';

-- Create experiment_log table if not exists (for migration tracking)
CREATE TABLE IF NOT EXISTS experiment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by user and action
CREATE INDEX IF NOT EXISTS idx_experiment_log_user_email ON experiment_log(user_email);
CREATE INDEX IF NOT EXISTS idx_experiment_log_action ON experiment_log(action);
CREATE INDEX IF NOT EXISTS idx_experiment_log_reason ON experiment_log(reason);
CREATE INDEX IF NOT EXISTS idx_experiment_log_created_at ON experiment_log(created_at);

COMMENT ON TABLE experiment_log IS 'Audit log for treatment/experiment changes';
