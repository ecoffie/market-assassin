-- Saved searches for the Opportunity Map (Zillow "Save search" → alert on new matches).
-- Each row = a named, filter-specific alert: the user's active filter set + viewport,
-- re-run by a cron that emails NEW matching opportunities. Idempotent.

CREATE TABLE IF NOT EXISTS saved_searches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email            TEXT NOT NULL,
  name                  TEXT NOT NULL,
  mode                  TEXT NOT NULL DEFAULT 'open',          -- open | recompete
  filters               JSONB NOT NULL DEFAULT '{}'::jsonb,    -- the full FILT set
  bbox                  JSONB,                                 -- {w,s,e,n} viewport at save time (optional)
  alerts_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  alert_frequency       TEXT NOT NULL DEFAULT 'daily',         -- daily | weekly | paused
  last_alerted_at       TIMESTAMPTZ,
  last_seen_notice_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,    -- dedupe: notice_ids already alerted
  total_alerts_sent     INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user    ON saved_searches(user_email);
CREATE INDEX IF NOT EXISTS idx_saved_searches_active  ON saved_searches(alerts_enabled, alert_frequency)
  WHERE alerts_enabled = TRUE;

-- RLS: service-role only (all access is via authed API routes using the service key).
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
