-- Weird Awards — the Discover feed of genuinely-curious REAL federal purchases.
--
-- GROUNDED, never fabricated (the operating-thesis guardrail): every row is a real
-- USASpending award with a real amount and a real award_id that links to its /awards/[id]
-- proof page. The build cron scans the awards table for a curated set of unmistakably-odd
-- purchase descriptions (petting zoos, dunk tanks, bagpipes…) and stores the real hits here.
-- Public + shareable + citable — the "did you see what the government spent money on" feed.

CREATE TABLE IF NOT EXISTS weird_awards (
  award_id          text PRIMARY KEY,          -- links to /awards/[award_id] (the proof)
  piid              text,
  recipient_name    text,
  awarding_agency   text,
  obligation_amount numeric,
  description       text,
  psc_description   text,
  category          text,                       -- the curious hook that matched (e.g. "petting zoo")
  action_date       date,
  recipient_state   text,
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weird_awards_amount ON weird_awards (obligation_amount DESC);
CREATE INDEX IF NOT EXISTS idx_weird_awards_category ON weird_awards (category);

ALTER TABLE weird_awards ENABLE ROW LEVEL SECURITY;

-- Monthly rebuild (dispatcher row, NOT vercel.json). 3rd of month, 10:00 UTC.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('build-weird-awards', '/api/cron/build-weird-awards', '0 10 3 * *', 120000, true,
   'Monthly rebuild of the Weird Awards Discover feed (/weird): scans awards for genuinely-curious REAL purchases -> weird_awards. Public, shareable, citable (each links to /awards/[id]). Bounded by maximumBytesBilled.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
