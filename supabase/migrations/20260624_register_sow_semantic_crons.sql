-- Register the semantic-corpus pipeline as recurring dispatcher jobs so the
-- embedded-opportunity corpus CLIMBS over time instead of stalling at ~9.5K
-- (Eric, Jun 24 2026).
--
--   sow-catalog       — extracts SOW/PWS scope text from opps that have
--                       attachments  →  sam_opportunities.sow_text
--   embed-sow-corpus  — embeds sow_text → sow_embedding (text-embedding-3-small),
--                       which powers hidden-match (beats keyword/NAICS filters)
--
-- Both are resumable + bounded; the dispatcher re-fires until drained and re-runs
-- as new opps sync in. embed is offset 5 min after extract so it picks up the
-- freshly-extracted SOWs each cycle. Idempotent: re-enables on re-apply.

INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('sow-catalog', '/api/cron/sow-catalog?limit=25', '0,15,30,45 * * * *', 120000, true,
   'Extract SOW/PWS scope text from opps with attachments -> sow_text. Feeds the semantic corpus; resumable, dispatcher re-fires until drained.'),
  ('embed-sow-corpus', '/api/cron/embed-sow-corpus?limit=40', '5,20,35,50 * * * *', 120000, true,
   'Embed sow_text -> sow_embedding (text-embedding-3-small) for hidden-match. Offset 5 min after sow-catalog so it embeds freshly-extracted SOWs.')
ON CONFLICT (job_name) DO UPDATE SET
  route      = EXCLUDED.route,
  cron_expr  = EXCLUDED.cron_expr,
  timeout_ms = EXCLUDED.timeout_ms,
  enabled    = true,
  notes      = EXCLUDED.notes;
