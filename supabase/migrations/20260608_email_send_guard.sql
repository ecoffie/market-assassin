-- Email send guard (#58) — krithi@datanetiix.com got 12 emails in a day → churned.
-- Root cause: ~15 independent email streams call sendEmail() with no global
-- coordination, and the central log table the code writes to never existed.

-- 1) The central send log sendEmail() already upserts to (was missing → silent
--    fail in try/catch). Now real, so we can COUNT + CAP per recipient.
CREATE TABLE IF NOT EXISTS email_provider_sends (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider            TEXT,
  provider_message_id TEXT,
  user_email          TEXT NOT NULL,
  subject             TEXT,
  email_type          TEXT,         -- 'daily_alert','weekly_brief','pursuit_brief','two_factor', etc.
  event_source        TEXT,
  tags                JSONB DEFAULT '{}'::jsonb,
  metadata            JSONB DEFAULT '{}'::jsonb,
  status              TEXT,
  sent_at             TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now()
);
-- Dedup key for the upsert path that has a provider message id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_eps_provider_msg
  ON email_provider_sends (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
-- The hot path for the daily cap: count today's sends to a recipient.
CREATE INDEX IF NOT EXISTS idx_eps_email_sent_at
  ON email_provider_sends (lower(user_email), sent_at DESC);

-- 2) Suppression list — one row per address that should get NO non-transactional
--    email (hard unsubscribe, complaint, bounce, or manual). Checked by sendEmail.
CREATE TABLE IF NOT EXISTS email_suppressions (
  user_email   TEXT PRIMARY KEY,
  reason       TEXT,                -- 'unsubscribe','complaint','bounce','manual','frequency'
  source       TEXT,                -- where it came from
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Seed the two known complaints so they stop immediately.
INSERT INTO email_suppressions (user_email, reason, source)
VALUES
  ('krithi@datanetiix.com', 'frequency', 'reported 12 emails/day, unsubscribed'),
  -- Allen White — exact address TBD; add when confirmed
  ('allenwhite@example.com', 'frequency', 'reported too many emails — PLACEHOLDER, fix address')
ON CONFLICT (user_email) DO NOTHING;
