-- Smart-profile click-learning columns (tasks/smart-profile-dead-table-findings.md, option A).
--
-- The smart-profile system's learning path (learnFromClick / updateEngagementScore)
-- targeted `user_briefing_profile` — a table that never existed — so click-weighted
-- personalization has been silently dead since ~March. Rather than create a whole
-- duplicate profile table (fork/sync risk), we store the learning on the REAL profile
-- row (user_notification_settings), alongside the naics_weights / agency_weights /
-- company_weights JSONB columns that ALREADY live there and are already read by the
-- generators' topNaics/topAgencies weighting.
--
-- Additive only: adds 6 columns, all nullable/defaulted. Does NOT alter or drop any
-- existing column. Safe to run on the live table with no downtime.
--
-- Hand-run in the Supabase SQL editor, then it NOTIFYs pgrst to reload the schema.

ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS clicked_naics         TEXT[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS clicked_agencies      TEXT[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS clicked_contractors   TEXT[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS clicked_opportunities TEXT[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_click_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engagement_score      INTEGER     DEFAULT 50;

-- Verify (should return 6 rows):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'user_notification_settings'
--       AND column_name IN ('clicked_naics','clicked_agencies','clicked_contractors',
--                           'clicked_opportunities','last_click_at','engagement_score');

NOTIFY pgrst, 'reload schema';
