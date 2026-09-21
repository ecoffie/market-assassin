-- SBA certification currency — the "has/had" vs "currently valid" distinction.
--
-- THE DEFECT (measured 2026-08-24, 250K extract lines + live mirror):
--   507 firms (17.1% of certified) carry an EXPIRED SBA certification.
--   467 of those have an ACTIVE SAM registration, so nothing else flags them.
--     KILIUDA CONSULTING, LLC          stored ["8(a)"]    Active  expired 2023-01-11
--     ALASKA PROFESSIONAL CONSTRUCTION stored ["HUBZone"] Active  expired 2024-03-19
--
-- The expiry was always in the token (`A620210726` = A6 + 20210726). The importer prefix-
-- matched it to get the LABEL right and discarded the date, so a cert that lapsed in 2021 and
-- one valid to 2029 both became the string "8(a)".
--
-- ⚠️ ADDITIVE ONLY. `certifications[]` is UNCHANGED and remains the compatibility field for
-- "has/had this certification". This column answers the different question — "is it CURRENTLY
-- VALID" — and nothing is wired to it in this migration.
--
-- ⚠️ THREE STATES, KEPT DISTINCT. `unknown` is never a synonym for `current`:
--     current  — dated, not yet expired
--     expired  — dated, past
--     unknown  — NO date in the source. This is the COMMON case for HUBZone: 1,234 of 1,390
--                tokens (89%) carry no date at all. Silently upgrading those to `current`
--                would assert currency for firms we know nothing about.
--
-- DATE-BEARING BEHAVIOUR DIFFERS BY PROGRAM (measured, not assumed):
--   A6  8(a)      ALWAYS dated  (1,509/1,521)   JT  8(a) JV  ALWAYS dated (231/231)
--   XX  HUBZone   MIXED — only 11% dated        A9/A0        not SBA-certified; out of scope

ALTER TABLE sam_entities
  ADD COLUMN IF NOT EXISTS certification_records jsonb;

COMMENT ON COLUMN sam_entities.certification_records IS
  'Per-certification currency from SAM extract field 117. Array of {certification_type, source_code, certification_expires_on, certification_status}. status = current|expired|unknown; unknown means the source carried NO date (89% of HUBZone) and must NEVER be read as current. certifications[] remains the has/had compatibility field. NULL = not yet backfilled.';

-- Find firms whose asserted certification has lapsed — the 467-firm population.
CREATE INDEX IF NOT EXISTS idx_sam_entities_certification_records
  ON sam_entities USING gin (certification_records)
  WHERE certification_records IS NOT NULL;
