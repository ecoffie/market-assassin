-- NOT APPLIED. Eric must authorize before `npm run migrate -- --go --only 20261119_sam_entities_incremental_cron.sql`.
--
-- Registers the incremental SAM entity slice (existing sync-gov-buyer-data?pull=entities).
-- It checkpoints in sam_entities_sync_state and does not reload the ~910k corpus.
-- Inserted DISABLED. Enabling it starts a bounded daily slice on top of the
-- existing chain from the full SAM opportunity sync.

INSERT INTO cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('sync-sam-entities', '/api/cron/sync-gov-buyer-data?pull=entities', '23 11 * * *', 280000, false,
   'Incremental SAM entity slices only. Disabled until Eric authorizes enablement. Do not point this at a full extract reload.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route,
  cron_expr = EXCLUDED.cron_expr,
  timeout_ms = EXCLUDED.timeout_ms,
  notes = EXCLUDED.notes;
