-- Add is_archived to user_pipeline so we can soft-delete completed /
-- abandoned opps without losing audit trail.
--
-- BD users asked for an "archive" action separate from the stage
-- dropdown — Tracking/Pursuing/Bidding/Submitted is the active
-- lifecycle, Won/Lost/No-Bid is the outcome, and Archive is "out
-- of mind, but preserved." Salesforce/HubSpot pattern.
--
-- Default false so existing rows stay visible. PATCH handler now
-- accepts is_archived on update payload.

ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- Index for the "show non-archived only" default query path. Most
-- list queries will filter is_archived=false, so this lets Postgres
-- avoid the full scan + filter even with thousands of rows per user.
CREATE INDEX IF NOT EXISTS idx_pipeline_archived ON user_pipeline(user_email, is_archived);

NOTIFY pgrst, 'reload schema';
