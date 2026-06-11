-- Daily metric snapshots — generic (date, metric_key, value) time-series so the
-- admin dashboard can chart ANY metric over time without recomputing from raw
-- events on every load. One row per metric per day. Idempotent upsert by
-- (snapshot_date, metric_key).
--
-- Why generic key/value instead of fixed columns: we want to add new charted
-- metrics (dau, wau, new_signups, profile_complete, setup_emails_sent,
-- accounts_created, alerts_sent, zero_alert_users, ...) without a migration each
-- time. The snapshot cron writes whatever keys it computes.

CREATE TABLE IF NOT EXISTS daily_metric_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  metric_key    text NOT NULL,                 -- e.g. 'dau', 'wau', 'new_signups'
  value         numeric NOT NULL DEFAULT 0,
  meta          jsonb,                          -- optional extra context for the metric
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per metric per day; the snapshot cron upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_metric_snapshots_date_key
  ON daily_metric_snapshots (snapshot_date, metric_key);

-- Fast "give me the series for metric X over the last N days".
CREATE INDEX IF NOT EXISTS idx_daily_metric_snapshots_key_date
  ON daily_metric_snapshots (metric_key, snapshot_date);
