-- Drop the two dead briefing-tracking columns on user_notification_settings.
--
-- WHY: neither column was ever WRITTEN by any code path. They reported 20 users as
-- having received a briefing when briefing_log — the authoritative delivery record —
-- shows 1,437 across 52,853 sends since 2026-03-11. Reading them produced three
-- wrong figures in a single session (a "747 briefing accounts" that is really 111
-- distinct recipients, and a "only 1 has ever received" that is really 126).
--
-- Their ONLY reader was /api/alerts/preferences, which serialised them into a JSON
-- response the /alerts/preferences page never destructures — dead end to end.
-- Removed in the same change.
--
-- The alert-side siblings (last_alert_sent, total_alerts_sent) are KEPT: the
-- preferences page actually renders those.
--
-- Anything needing "when did this user last get a briefing?" should query
-- briefing_log (user_email, briefing_date, delivery_status).
--
-- Safe: the reading endpoint uses select('*'), so dropping the columns cannot break
-- a named-column query. Verified no other reference in src/, scripts/, or supabase/.

ALTER TABLE user_notification_settings
  DROP COLUMN IF EXISTS last_briefing_sent,
  DROP COLUMN IF EXISTS total_briefings_sent;
