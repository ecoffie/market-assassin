-- Recent Big Awards — the "This Week in Government Spending" Discover feed (/spending).
--
-- GROUNDED: every row is a real USASpending award (real amount, real award_id -> /awards/[id]
-- proof). The build cron pulls the biggest recent federal obligations; the page reads cheap
-- from Supabase. This is the "did you see what the government spent" surface — built to be
-- screenshot + quoted, with a citable link so it holds up when someone checks (news-as-source).

CREATE TABLE IF NOT EXISTS recent_big_awards (
  award_id          text PRIMARY KEY,          -- links to /awards/[award_id] (the proof)
  piid              text,
  recipient_name    text,
  awarding_agency   text,
  obligation_amount numeric,
  description       text,
  naics_description text,
  action_date       date,
  recipient_state   text,
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_big_awards_amount ON recent_big_awards (obligation_amount DESC);

ALTER TABLE recent_big_awards ENABLE ROW LEVEL SECURITY;

-- Weekly rebuild (dispatcher row, NOT vercel.json). Mondays 08:00 UTC.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('build-recent-spending', '/api/cron/build-recent-spending', '0 8 * * 1', 120000, true,
   'Weekly rebuild of the "This Week in Government Spending" feed (/spending): biggest recent federal awards -> recent_big_awards. Public, shareable, citable (each links to /awards/[id]). Bounded BQ scan.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
