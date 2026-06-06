-- Relationships v2 (PRD-relationships-from-target-list, v2)
-- Adds:
--   target_agency      — which TARGET agency this relationship belongs to
--                        (the long-game BD link; v1 stored this in `agency`).
--   relationship_stage — where the relationship stands: prospect → warm →
--                        contacted → met → champion. Lets "who do I know at
--                        Army, and how warm?" be one glance.
--
-- Hand-run in the Supabase SQL editor (this DB has no in-app DDL), then run
-- `NOTIFY pgrst, 'reload schema';` so PostgREST sees the new columns.

ALTER TABLE mi_beta_contacts
  ADD COLUMN IF NOT EXISTS target_agency TEXT,
  ADD COLUMN IF NOT EXISTS relationship_stage TEXT DEFAULT 'prospect';

-- Backfill target_agency from the existing `agency` (v1 relationships stored
-- the agency there). Safe to re-run.
UPDATE mi_beta_contacts
   SET target_agency = agency
 WHERE target_agency IS NULL AND agency IS NOT NULL AND agency <> '';

-- Index for the per-agency grouping / "my network at <agency>" queries.
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_target_agency
  ON mi_beta_contacts (user_email, target_agency);

-- Tell PostgREST to reload (otherwise writes fail "column not in schema cache").
NOTIFY pgrst, 'reload schema';
