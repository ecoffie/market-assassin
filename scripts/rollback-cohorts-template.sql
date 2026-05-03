-- ============================================================
-- ROLLBACK TEMPLATE FOR EXPERIMENT COHORT ASSIGNMENTS
-- ============================================================
--
-- USAGE:
-- 1. The main script generates a date-specific rollback file
-- 2. This template can be used for manual rollback if needed
--
-- Run in Supabase SQL Editor
-- ============================================================

BEGIN;

-- Option 1: Rollback ALL cohort assignments
UPDATE user_notification_settings
SET
  experiment_cohort = NULL,
  cohort_assigned_at = NULL,
  beta_pioneer = FALSE
WHERE experiment_cohort IS NOT NULL;

-- Log the rollback
INSERT INTO experiment_log (user_email, action, cohort_before, cohort_after, reason)
SELECT
  user_email,
  'rollback',
  experiment_cohort,
  NULL,
  'manual_full_rollback'
FROM user_notification_settings
WHERE experiment_cohort IS NOT NULL;

COMMIT;

-- ============================================================
-- ALTERNATIVE: Rollback specific cohort only
-- ============================================================

-- BEGIN;
--
-- -- Rollback only the briefings cohort
-- UPDATE user_notification_settings
-- SET
--   experiment_cohort = NULL,
--   cohort_assigned_at = NULL
-- WHERE experiment_cohort = 'experiment_briefings';
--
-- INSERT INTO experiment_log (user_email, action, cohort_before, cohort_after, reason)
-- SELECT user_email, 'rollback', 'experiment_briefings', NULL, 'rollback_briefings_cohort'
-- FROM user_notification_settings
-- WHERE experiment_cohort = 'experiment_briefings';
--
-- COMMIT;

-- ============================================================
-- ALTERNATIVE: Rollback by date
-- ============================================================

-- BEGIN;
--
-- -- Rollback assignments made on a specific date
-- UPDATE user_notification_settings
-- SET
--   experiment_cohort = NULL,
--   cohort_assigned_at = NULL
-- WHERE DATE(cohort_assigned_at) = '2026-04-27';
--
-- INSERT INTO experiment_log (user_email, action, cohort_before, cohort_after, reason)
-- SELECT user_email, 'rollback', experiment_cohort, NULL, 'rollback_by_date_2026-04-27'
-- FROM user_notification_settings
-- WHERE DATE(cohort_assigned_at) = '2026-04-27'
-- AND experiment_cohort IS NOT NULL;
--
-- COMMIT;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check current cohort distribution
SELECT experiment_cohort, COUNT(*)
FROM user_notification_settings
WHERE experiment_cohort IS NOT NULL
GROUP BY experiment_cohort
ORDER BY experiment_cohort;

-- Check recent experiment log entries
SELECT *
FROM experiment_log
ORDER BY created_at DESC
LIMIT 20;

-- Check if any users are still assigned
SELECT COUNT(*) as assigned_count
FROM user_notification_settings
WHERE experiment_cohort IS NOT NULL;
