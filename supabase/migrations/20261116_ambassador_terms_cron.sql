-- Daily: end each Mindy Ambassador's twelve-month term (/api/cron/ambassador-terms).
-- Day 335 → term-ending email (once); day 365 → revoke the Pro grant and mark the row `ended`.
-- Dispatcher row, NOT vercel.json. 13:41 UTC daily.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('ambassador-terms', '/api/cron/ambassador-terms', '41 13 * * *', 110000, true,
   'Daily: Mindy Ambassador twelve-month term. Day 335 notice email, day 365 revoke Pro + mark ended. Owner decision 2026-11-16.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
