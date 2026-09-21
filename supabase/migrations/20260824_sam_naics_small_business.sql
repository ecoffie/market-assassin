-- P0-3: persist SAM's per-NAICS small-business representation.
--
-- ROOT CAUSE THIS FIXES: SAM ships small-business status PER NAICS
-- (assertions.goodsAndServices.naicsList[].sbaSmallBusiness in the Entity API;
-- field 34 "332312Y~423310Y" in the bulk extract). Both of Mindy's ingestion
-- parsers strip it, so market-research.ts had no size signal and substituted
-- socioeconomic certification matching -- which returned ZERO for NAICS 561720
-- despite 21,933 active registrants and 10 known performers, because those firms
-- hold no socioeconomic certification at all.
--
-- WHY A MAP AND NOT AN ARRAY OF "SMALL" CODES:
-- Storing only the Y codes would lose the distinction between "SAM says NOT small
-- for this NAICS" (N) and "SAM never said" (absent). That is the same
-- unknown-vs-none collapse behind P0-2 and DEFECT-7/8. A Rule-of-Two
-- determination must be able to tell those apart, so the raw per-NAICS status is
-- preserved as jsonb and the query-optimised array is a DERIVED projection.
--
-- Idempotent.

ALTER TABLE sam_entities
  -- Raw truth: { "561720": "Y", "541512": "N" }. Absent key = SAM did not say.
  ADD COLUMN IF NOT EXISTS naics_small_business jsonb,
  -- Query projection: codes where the value is exactly 'Y'. Derived, never authoritative.
  ADD COLUMN IF NOT EXISTS small_business_naics text[],
  -- Provenance: which pipeline observed the status, and from which snapshot.
  ADD COLUMN IF NOT EXISTS naics_sb_source text,
  ADD COLUMN IF NOT EXISTS naics_sb_observed_at timestamptz;

COMMENT ON COLUMN sam_entities.naics_small_business IS
  'Per-NAICS SAM small-business representation: {"<naics>":"Y"|"N"}. A MISSING key means SAM did not supply a status -- it does NOT mean "not small". SELF-CERTIFIED by the entity in its SAM registration; not SBA-vetted. Authoritative source for size questions.';
COMMENT ON COLUMN sam_entities.small_business_naics IS
  'DERIVED projection of naics_small_business: codes whose value is Y. Exists for GIN-indexed containment queries. Never write it independently -- always derive, or Y/N/unknown will drift apart.';
COMMENT ON COLUMN sam_entities.naics_sb_source IS
  'Which pipeline observed the status: sam_entity_api | sam_bulk_extract:<FILENAME>.';
COMMENT ON COLUMN sam_entities.naics_sb_observed_at IS
  'When the status was observed. For a bulk extract this is the SNAPSHOT date, not the import time.';

-- Containment lookups: WHERE small_business_naics @> ARRAY['561720']
CREATE INDEX IF NOT EXISTS idx_sam_entities_small_business_naics
  ON sam_entities USING GIN (small_business_naics);

-- Lets a query ask "did SAM say anything at all about this NAICS?" without
-- reading the whole jsonb -- the unknown-vs-none check.
CREATE INDEX IF NOT EXISTS idx_sam_entities_naics_sb_map
  ON sam_entities USING GIN (naics_small_business jsonb_path_ops);
