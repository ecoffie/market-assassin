-- migrate:no-transaction
-- DRAFT — NOT APPLIED. Needs Eric's approval (Agent 5 cache review #2, 2026-11-15). Kept OUT of supabase/migrations/ on
-- purpose so `npm run migrate` cannot pick it up. To adopt: copy to supabase/migrations/<date>_sam_opportunities_snapshot_changed_at.sql.
--
-- Why: the cached open retrieval treats a row as "changed since the snapshot" by the writers' own stamps
-- (synced_at / description_checked_at / sow_checked_at / updated_at). That is a convention: a writer that edits text
-- without stamping makes a silent false negative, and the SAM sync stamps synced_at on ~8,000 rows whose content did not
-- change (the cache then refuses after every sync). This column is stamped by the DATABASE, only when a column the
-- snapshot evaluates — or that moves a row into / out of the open set — actually changes.
--
-- Idempotent. No data rewrite: existing rows keep NULL (= unchanged); new rows and real changes get now().
-- CONCURRENTLY for the index, so writes are not blocked (hence no-transaction).

ALTER TABLE public.sam_opportunities ADD COLUMN IF NOT EXISTS snapshot_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.sam_opportunities_stamp_snapshot_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.snapshot_changed_at := now();
  ELSIF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.sow_text IS DISTINCT FROM OLD.sow_text
     OR NEW.department IS DISTINCT FROM OLD.department
     OR NEW.sub_tier IS DISTINCT FROM OLD.sub_tier
     OR NEW.solicitation_number IS DISTINCT FROM OLD.solicitation_number
     OR NEW.naics_code IS DISTINCT FROM OLD.naics_code
     OR NEW.psc_code IS DISTINCT FROM OLD.psc_code
     OR NEW.set_aside_code IS DISTINCT FROM OLD.set_aside_code
     OR NEW.set_aside_description IS DISTINCT FROM OLD.set_aside_description
     OR NEW.response_deadline IS DISTINCT FROM OLD.response_deadline
     OR NEW.active IS DISTINCT FROM OLD.active THEN
    NEW.snapshot_changed_at := now();
  ELSE
    -- An unchanged upsert keeps the old stamp; writers cannot fake or erase a change.
    NEW.snapshot_changed_at := OLD.snapshot_changed_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sam_opportunities_snapshot_change ON public.sam_opportunities;
CREATE TRIGGER sam_opportunities_snapshot_change
  BEFORE INSERT OR UPDATE ON public.sam_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.sam_opportunities_stamp_snapshot_change();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sam_opportunities_snapshot_changed_at
  ON public.sam_opportunities (snapshot_changed_at) WHERE active = true;
