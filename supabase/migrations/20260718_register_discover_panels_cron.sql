-- Register the build-discover-panels cron (dispatcher, NOT vercel.json). Rebuilds the
-- two computed Discover panels (NAICS leaderboard + most-concentrated markets) into
-- discover_panel_cache from live USASpending so the public landing reads cheap. The
-- market-spend windows move slowly, so daily is plenty.
INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('build-discover-panels', '/api/cron/build-discover-panels', '0 11 * * *', 120000, true,
   'Daily rebuild of the two computed Discover panels on /mindy-landing (NAICS leaderboard by 3-FY spend + FY-over-FY movement; most-concentrated markets by top-5 vendor share) into discover_panel_cache. Real USASpending data only.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route, cron_expr = EXCLUDED.cron_expr, timeout_ms = EXCLUDED.timeout_ms,
  enabled = true, notes = EXCLUDED.notes;
