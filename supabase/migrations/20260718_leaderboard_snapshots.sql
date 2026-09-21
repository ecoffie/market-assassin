-- Leaderboard ranking snapshots — powers the ▲▼ rank-movement on /top/[slug].
--
-- PUBLIC ranking data only: point-in-time position of each contractor within a
-- listicle, by total federal obligated $ (from USASpending rollups). This is NOT
-- the moat change-log (recompete_changes) — that stays private, reserved for the
-- M&A / financial-firm play. This table exposes nothing proprietary; it just lets a
-- public ranking show "moved up 2" like a stock board.
--
-- ▲▼ = current rank vs the previous snapshot. Like the moat log, it CANNOT be
-- backfilled — movement only accrues from the first snapshot forward. That is the
-- whole reason to start recording now, before it is obviously useful.

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  snapshot_date   date        NOT NULL,
  slug            text        NOT NULL,        -- the /top/[slug] listicle
  recipient_uei   text        NOT NULL,
  recipient_name  text,
  rank            integer     NOT NULL,        -- 1-based position at snapshot time
  total_amount    numeric,                     -- obligated $ (reference)
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, slug, recipient_uei)
);

-- The hot read: "latest snapshots for this slug, newest first."
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_slug_date
  ON leaderboard_snapshots (slug, snapshot_date DESC);

-- Service-role only — crons write, server components read via the service client.
ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

-- Weekly point-in-time snapshot (dispatcher row, NOT vercel.json). Mondays 09:00 UTC.
-- The underlying rollups rebuild monthly (refresh-bq-rollups, 5th), so movement shows
-- after each rebuild; weekly cadence keeps a clean recent baseline cheaply (rollup
-- reads are a few MB each, KV-cached).
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('snapshot-leaderboards', '/api/cron/snapshot-leaderboards', '0 9 * * 1', 120000, true,
   'Weekly point-in-time snapshot of /top/[slug] contractor rankings -> leaderboard_snapshots. Powers the public ▲▼ rank movement. Public ranking data only (NOT the moat change-log). Cheap: rollup reads, KV-cached.')
ON CONFLICT (job_name) DO UPDATE SET
  route      = EXCLUDED.route,
  cron_expr  = EXCLUDED.cron_expr,
  timeout_ms = EXCLUDED.timeout_ms,
  enabled    = true,
  notes      = EXCLUDED.notes;
