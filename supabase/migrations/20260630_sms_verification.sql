-- SMS double opt-in + verification (2026-06-30)
-- Adds verify-before-activate + STOP opt-out state to the canonical
-- user_notification_settings table. pursuit-changes SMS gates on phone_verified
-- (NOT just sms_enabled) so we never text an unverified/unconsented number.
-- Idempotent: safe to re-run.

ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS phone_verified       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at    timestamptz,
  -- Short-lived 6-digit code + expiry for the double opt-in handshake.
  ADD COLUMN IF NOT EXISTS sms_verify_code      text,
  ADD COLUMN IF NOT EXISTS sms_verify_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_verify_attempts  int         NOT NULL DEFAULT 0,
  -- Set true when the user replies STOP (mirrored from the Twilio sms-webhook)
  -- so pursuit-changes respects opt-out even if carrier state and our DB drift.
  ADD COLUMN IF NOT EXISTS sms_opted_out        boolean     NOT NULL DEFAULT false;

-- Reload PostgREST's schema cache so the new columns are queryable immediately.
NOTIFY pgrst, 'reload schema';
