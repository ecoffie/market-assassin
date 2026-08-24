-- SAM purpose-of-registration — the grants-only vs contract-eligible distinction.
--
-- WHY (measured 2026-08-24 against the Aug-2026 public extract, 120K lines):
--   Z2  72.0%   All Awards  (contracts + assistance)
--   Z1  28.0%   Federal Assistance ONLY  -> CANNOT receive a federal contract
--   Z3   0.1%   / Z4, Z5 ~0%
--
-- The index was confirmed by CROSS-CHECK, not by the layout PDF: Z1 has no NAICS in
-- 33,494 of 33,541 cases (99.86%), while Z2 has NAICS in 100% of 86,355. The mirror
-- independently shows 26.9% of its 910,123 rows with no primary NAICS, corroborating
-- the 28.0% from source.
--
-- ⚠️ ADDITIVE ONLY. This migration adds a column and changes NO existing count. Wiring it
-- into eligibility/market-depth is a SEPARATE, measured step — "materialize first, measure
-- by NAICS, then change product semantics" (Eric).
--
-- ⚠️ THE INVARIANT this exists to support:
--   "Eligibility for procurement must not be inferred merely from presence in the SAM
--    entity registry." A registration can exist for federal ASSISTANCE only.
--
-- NULL means UNKNOWN (not yet backfilled), never "contract-eligible". Anything reading this
-- column must treat null as unknown rather than defaulting it to Z2.

ALTER TABLE sam_entities
  ADD COLUMN IF NOT EXISTS purpose_of_registration text;

COMMENT ON COLUMN sam_entities.purpose_of_registration IS
  'SAM purposeOfRegistration code (extract field idx 6). Z1=Federal Assistance ONLY (grants; NOT contract-eligible), Z2=All Awards, Z3/Z4/Z5 rare. NULL = unknown/not backfilled — never assume contract-eligible.';

-- Partial index: the queries that matter ask "which of these are NOT grants-only", so the
-- selective values are what need indexing, not the 72% Z2 majority.
CREATE INDEX IF NOT EXISTS idx_sam_entities_purpose_of_registration
  ON sam_entities (purpose_of_registration)
  WHERE purpose_of_registration IS NOT NULL;
