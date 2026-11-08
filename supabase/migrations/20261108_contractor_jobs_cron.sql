-- Daily schedule for sync-contractor-jobs (dispatcher row, NOT vercel.json).
-- Apply AFTER: (1) the route is deployed, (2) JSEARCH_API_KEY + USAJOBS_API_KEY are set in
-- Vercel production, (3) one manual run returned 200 with rows. 10:17 UTC daily.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('sync-contractor-jobs', '/api/cron/sync-contractor-jobs', '17 10 * * *', 280000, true,
   'Daily: contractor + federal job postings (JSearch, USAJobs) -> contractor_job_postings. Feeds hiring signals on contractor pages, the Map and recompetes.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
