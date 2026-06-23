-- Coach Mode: per-client alert recipient.
--
-- Coach-created client workspaces store their notification profile under a
-- synthetic email ({workspaceId}@clients.getmindy.ai), which is NOT a real
-- mailbox — so daily/weekly alert sends to user_email bounce. This column lets a
-- coach set the client's REAL inbox; the alert crons send to
-- alert_recipient_email when present, falling back to user_email otherwise.
--
-- Nullable + no default → existing rows are unaffected and keep using user_email.

ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS alert_recipient_email TEXT;
