-- Mark a sam_events row past its event_date without deleting it.
-- extract-sam-events sets expired_at. SAM_EVENTS_PRUNE is unchanged and does not read this column.
-- Idempotent. Apply only with: npm run migrate -- --go --only 20261118_sam_events_expired_at.sql

ALTER TABLE sam_events
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

COMMENT ON COLUMN sam_events.expired_at IS
  'Set by extract-sam-events when event_date is before the run date. The row stays. Null means not marked. SAM_EVENTS_PRUNE does not use this column.';

NOTIFY pgrst, 'reload schema';
