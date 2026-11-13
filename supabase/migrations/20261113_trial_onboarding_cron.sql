-- Daily schedule for trial-onboarding (dispatcher row, NOT vercel.json).
-- Sends the day 1 / 3 / 7 trial emails and the day-11 "what Mindy found" reminder fallback.
-- Apply AFTER the route is deployed and one ?dry=1 run returned 200. 14:13 UTC daily (~9 AM ET).
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('trial-onboarding', '/api/cron/trial-onboarding', '13 14 * * *', 280000, true,
   'Daily: Mindy Pro/Team trial onboarding emails (day 1 call, day 3 recompetes, day 7 halfway, day 11 found+reminder fallback). KV-claimed per sub+step.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
