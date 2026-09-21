-- Resend send/event capture for per-user email analytics.
-- This keeps provider-level delivery, bounce, complaint, open, and click events
-- queryable in Supabase instead of only inside the Resend dashboard.

CREATE TABLE IF NOT EXISTS email_provider_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  user_email TEXT,
  subject TEXT,
  email_type TEXT,
  event_source TEXT,
  tags JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_sends_provider_message
  ON email_provider_sends(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_provider_sends_email
  ON email_provider_sends(user_email, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_provider_sends_type
  ON email_provider_sends(email_type, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_provider_sends_tags
  ON email_provider_sends USING GIN(tags);

CREATE TABLE IF NOT EXISTS email_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_event_id TEXT,
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  user_email TEXT,
  email_type TEXT,
  event_source TEXT,
  tags JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_events_provider_event
  ON email_provider_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_provider_events_message
  ON email_provider_events(provider_message_id);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_email
  ON email_provider_events(user_email, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_type
  ON email_provider_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_tags
  ON email_provider_events USING GIN(tags);

COMMENT ON TABLE email_provider_sends IS 'Provider-level email send records, including Resend message ids, tags, and analytics metadata.';
COMMENT ON TABLE email_provider_events IS 'Raw and normalized provider webhook events from Resend for delivery, bounce, complaint, open, and click analytics.';
