-- Pursuit change/amendment alerts (Eric: "notify me of any changes/amendments
-- to pursuits I'm tracking, pursuing, or bidding").
--
-- pursuit_change_log — one row per detected change on a tracked pursuit. Drives
-- the email digest AND the in-app "⚠️ Amendment" badge. The latest unacknowledged
-- rows per pursuit show on the card; ack clears the badge.
--
-- We snapshot the SAM-side state (deadline, notice_type, last_modified,
-- docs_count) right on user_pipeline (already has docs_count) + a small
-- monitor-state table so the cron can diff cheaply.
--
-- Hand-run in the Supabase SQL editor, then NOTIFY pgrst.

CREATE TABLE IF NOT EXISTS pursuit_change_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pursuit_id    UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  notice_id     TEXT,
  change_type   TEXT NOT NULL,   -- deadline | amendment | notice_type | documents | cancelled | awarded
  summary       TEXT NOT NULL,   -- human line: "Deadline moved Jun 12 → Jun 19"
  old_value     TEXT,
  new_value     TEXT,
  acknowledged  BOOLEAN DEFAULT FALSE,
  emailed       BOOLEAN DEFAULT FALSE,
  detected_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pursuit_change_log_user
  ON pursuit_change_log (user_email, acknowledged, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pursuit_change_log_pursuit
  ON pursuit_change_log (pursuit_id, acknowledged);

-- Per-pursuit monitor snapshot — the last SAM-side state we saw, so the cron
-- diffs against it. Keyed by pursuit so each user's tracked copy is independent.
CREATE TABLE IF NOT EXISTS pursuit_monitor_state (
  pursuit_id        UUID PRIMARY KEY REFERENCES user_pipeline(id) ON DELETE CASCADE,
  notice_id         TEXT,
  last_deadline     TEXT,
  last_notice_type  TEXT,
  last_modified     TEXT,        -- SAM last_modified value
  last_docs_count   INT,
  last_checked_at   TIMESTAMPTZ DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
