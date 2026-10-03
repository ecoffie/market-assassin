-- SEC-5b (2026-10-03): user_notification_settings.briefings_enabled DEFAULT was TRUE, so every
-- row created by a writer that omits the column (free signups, coach clients, workspace
-- members, sample-opportunities, ...) started with briefings "on" although it grants nothing:
-- delivery also requires an entitled customer_classifications row (rollout.ts
-- isBriefingEntitled). Measured 2026-10-03: 44 of 239 TRUE rows had no entitlement, 35 of
-- them created in the last 30 days. Three marketing crons read TRUE as "is Pro"
-- (upgrade-drip, bootcamp-lifetime-offer skip them; setup-invite-batch counts them entitled).
--
-- Every paid provisioning path writes TRUE explicitly (ensureNotificationSettings,
-- grantBriefingAccess, the paid-state refresh in paused-delivery.ts, briefings-entitlement
-- sync, grant-mindy-pro-once), guarded by briefings-default-writers.unit.test.ts, so this
-- changes only rows that omit the column. Existing rows are NOT modified (no backfill).
-- Idempotent.
ALTER TABLE IF EXISTS user_notification_settings
  ALTER COLUMN briefings_enabled SET DEFAULT false;
