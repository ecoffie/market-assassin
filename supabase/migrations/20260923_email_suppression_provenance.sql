-- Deliverability P0 (2026-09-23): make Resend delivery events load-bearing.
--
-- email_suppressions has existed since #58 (20260608_email_send_guard.sql) and the
-- sendEmail() guard already refuses non-transactional mail to any address in it — but
-- nothing ever WROTE bounces or complaints into it (1 row, fleet-wide). The Resend
-- webhook now does (src/lib/email/suppression.ts). These columns preserve the provider
-- reason, status and timestamps behind each suppression so every row is auditable.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS only. No existing row is changed,
-- no row is deleted, and the primary key (user_email) — which is what makes webhook
-- replay idempotent (insert-if-absent) — is untouched.

ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS provider            TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS provider_event_id   TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS email_type          TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS bounce_type         TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS bounce_subtype      TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS diagnostic          TEXT;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS event_at            TIMESTAMPTZ;
ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS metadata            JSONB DEFAULT '{}'::jsonb;

COMMENT ON TABLE email_suppressions IS
  'MAILBOX suppression: addresses that must receive no non-transactional mail (hard bounce, complaint, provider-suppressed, repeated transient bounce, synthetic, unsubscribe/frequency/manual). Distinct from the product preference user_notification_settings.alerts_enabled. Written by the Resend webhook; checked by sendEmail(). Rows are never auto-removed by later delivery.';

-- The transient-bounce rule reads an address's recent bounced/delivered events.
CREATE INDEX IF NOT EXISTS idx_email_provider_events_email_type_time
  ON email_provider_events (user_email, event_type, occurred_at DESC);
