-- pursuit-changes: add last_active to the monitor snapshot.
--
-- SAM's opportunities API publishes NO per-notice last-modified timestamp (only
-- postedDate/archiveDate/responseDeadLine/active), so amendment detection was
-- permanently blind on the old `last_modified` column (null cache-wide). The
-- rewrite detects on the real fields SAM returns; `active` going true→false means
-- the pursuit closed/archived. We snapshot it here. (posted_date reuses the
-- existing last_modified TEXT column — no new column needed for that.)
ALTER TABLE pursuit_monitor_state
  ADD COLUMN IF NOT EXISTS last_active BOOLEAN;

COMMENT ON COLUMN pursuit_monitor_state.last_active IS
  'Snapshot of sam_opportunities.active — a true→false change = pursuit closed/archived.';
