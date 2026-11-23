-- NOT APPLIED. Needs Eric's approval + independent review, then:
--   npm run migrate -- --go --only 20261123_sam_entities_registration_dates.sql
--
-- SAM registration dates on sam_entities — so Mindy can list businesses that are NEW to SAM.gov.
--
-- The public entity extract already carries these fields (src/lib/sam/entity-extract-layout.ts):
--   idx 24 initialRegistrationDate  — first time the entity ever registered (the "new" signal)
--   idx 7  registrationDate         — date of the current registration (renewals move it)
--   idx 10 activationDate           — date the current registration went active
-- scripts/import-sam-entity-extract.mjs parsed and discarded them. It now writes them
-- (and purpose_of_registration, added by 20260824_sam_purpose_of_registration.sql, which this
-- migration also ensures exists).
--
-- ⚠️ ADDITIVE ONLY. No existing count changes. NULL = unknown / not yet backfilled — never
-- "old" and never "new". Rows fill on the next extract import.

ALTER TABLE sam_entities
  ADD COLUMN IF NOT EXISTS purpose_of_registration text,
  ADD COLUMN IF NOT EXISTS initial_registration_date date,
  ADD COLUMN IF NOT EXISTS sam_registration_date date,
  ADD COLUMN IF NOT EXISTS sam_activation_date date;

COMMENT ON COLUMN sam_entities.initial_registration_date IS
  'SAM initialRegistrationDate (extract idx 24): first-ever SAM registration. NULL = unknown/not backfilled.';
COMMENT ON COLUMN sam_entities.sam_registration_date IS
  'SAM registrationDate (extract idx 7): date of the current registration; renewals move it. NULL = unknown.';
COMMENT ON COLUMN sam_entities.sam_activation_date IS
  'SAM activationDate (extract idx 10): date the current registration went active. NULL = unknown.';

-- "Who is new since <date>" reads a recent slice; index only populated rows.
CREATE INDEX IF NOT EXISTS idx_sam_entities_initial_registration_date
  ON sam_entities (initial_registration_date DESC)
  WHERE initial_registration_date IS NOT NULL;
