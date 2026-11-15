-- migrate:no-transaction
-- ROLLBACK for snapshot_changed_at.up.sql (DRAFT, not applied). Order: stop stamping, drop index, drop column.
-- Before running: set OPEN_SNAPSHOT_CHANGE_MARKER back to unset (legacy stamps) or keep OPEN_SNAPSHOT_RETRIEVAL off.
DROP TRIGGER IF EXISTS sam_opportunities_snapshot_change ON public.sam_opportunities;
DROP FUNCTION IF EXISTS public.sam_opportunities_stamp_snapshot_change();
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sam_opportunities_snapshot_changed_at;
ALTER TABLE public.sam_opportunities DROP COLUMN IF EXISTS snapshot_changed_at;
