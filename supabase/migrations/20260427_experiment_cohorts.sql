-- ============================================================
-- EXPERIMENT COHORT SYSTEM
-- A/B/Hold test infrastructure for daily alerts vs daily briefings
-- Created: April 27, 2026
-- ============================================================

-- ============================================================
-- 1. ADD EXPERIMENT COLUMNS TO user_notification_settings
-- ============================================================

-- Experiment cohort assignment
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS experiment_cohort TEXT;

-- When cohort was assigned
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS cohort_assigned_at TIMESTAMPTZ;

-- Whether user is a paid customer (takes priority over free cohorts)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS paid_status BOOLEAN DEFAULT FALSE;

-- Stripe customer ID for paid users
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Products owned (for paid users)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS products_owned JSONB DEFAULT '[]'::jsonb;

-- Beta pioneer flag (marks users who were in original beta)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS beta_pioneer BOOLEAN DEFAULT FALSE;

-- Engagement metrics for stratification
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS alerts_opened_30d INTEGER DEFAULT 0;

-- Set-aside certifications for stratification analysis
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS set_aside_certifications TEXT[] DEFAULT '{}';

-- Indexes for experiment queries
CREATE INDEX IF NOT EXISTS idx_notif_settings_experiment_cohort
ON user_notification_settings(experiment_cohort);

CREATE INDEX IF NOT EXISTS idx_notif_settings_paid_status
ON user_notification_settings(paid_status);

CREATE INDEX IF NOT EXISTS idx_notif_settings_beta_pioneer
ON user_notification_settings(beta_pioneer);

-- ============================================================
-- 2. CREATE EXPERIMENT LOG TABLE
-- Tracks all cohort assignments and changes
-- ============================================================

CREATE TABLE IF NOT EXISTS experiment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL, -- 'assign', 'reassign', 'remove', 'rollback'
  cohort_before TEXT,
  cohort_after TEXT,
  reason TEXT, -- 'initial_assignment', 'paid_upgrade', 'manual_override', 'rollback'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookup
CREATE INDEX IF NOT EXISTS idx_experiment_log_user_email
ON experiment_log(user_email);

-- Index for finding changes by date
CREATE INDEX IF NOT EXISTS idx_experiment_log_created_at
ON experiment_log(created_at);

-- Index for finding changes by action
CREATE INDEX IF NOT EXISTS idx_experiment_log_action
ON experiment_log(action);

-- RLS
ALTER TABLE experiment_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on experiment_log" ON experiment_log
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE experiment_log IS 'Audit trail for experiment cohort assignments';

-- ============================================================
-- 3. CREATE EXPERIMENT COHORTS SUMMARY VIEW
-- For quick analysis during the experiment
-- ============================================================

CREATE OR REPLACE VIEW experiment_cohort_summary AS
SELECT
  experiment_cohort,
  COUNT(*) as user_count,
  AVG(alerts_opened_30d) as avg_alerts_opened,
  COUNT(CASE WHEN '8(a)' = ANY(set_aside_certifications) THEN 1 END) as count_8a,
  COUNT(CASE WHEN 'SDVOSB' = ANY(set_aside_certifications) THEN 1 END) as count_sdvosb,
  COUNT(CASE WHEN 'WOSB' = ANY(set_aside_certifications) THEN 1 END) as count_wosb,
  COUNT(CASE WHEN 'HUBZone' = ANY(set_aside_certifications) THEN 1 END) as count_hubzone,
  COUNT(CASE WHEN array_length(set_aside_certifications, 1) IS NULL OR array_length(set_aside_certifications, 1) = 0 THEN 1 END) as count_no_cert
FROM user_notification_settings
WHERE experiment_cohort IS NOT NULL
GROUP BY experiment_cohort
ORDER BY
  CASE experiment_cohort
    WHEN 'experiment_briefings' THEN 1
    WHEN 'experiment_alerts' THEN 2
    WHEN 'experiment_hold' THEN 3
    WHEN 'paid_existing' THEN 4
    ELSE 5
  END;

-- ============================================================
-- DONE
-- ============================================================
-- Run this migration with: psql or Supabase SQL Editor
-- Then run the cohort assignment script
