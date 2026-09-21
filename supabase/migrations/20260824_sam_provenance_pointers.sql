-- SAM preservation: provenance POINTERS, not payloads.
--
-- Architecture (Eric, 2026-08-24):
--   GCS      = immutable source evidence (the monthly ZIP)
--   BigQuery = large analytical datasets
--   Postgres = normalized operational/decision fields + provenance pointers
--   Vercel   = application/runtime
--
-- WHY NOT raw_data: a full SAM Entity payload is 83,322 bytes; across 910,123 rows that is
-- 75.8 GB, and even a slimmed variant is 7.5 GB. Measured before proposing. These six
-- columns are ~80 bytes/row (~73 MB total) and point AT the evidence rather than copying it.
-- Recoverability comes from the archived ZIP: read archive -> re-parse -> backfill a typed
-- column. No re-download from SAM, no warehouse in the transactional database.
--
-- Idempotent.

ALTER TABLE sam_entities
  -- 'bulk_extract' | 'entity_api'
  ADD COLUMN IF NOT EXISTS sam_source_type text,
  -- The SNAPSHOT date the data represents, e.g. '2026-08-02'. Not the ingestion date.
  ADD COLUMN IF NOT EXISTS sam_source_snapshot date,
  -- The immutable GCS object key that produced this row, e.g.
  -- 'monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP'. This is the lineage pointer:
  -- a filename alone cannot identify WHICH archived bytes were parsed.
  ADD COLUMN IF NOT EXISTS sam_source_object text,
  ADD COLUMN IF NOT EXISTS sam_ingested_at timestamptz,
  -- Bump when the parser's FIELD MAPPING changes, so rows parsed by different logic are
  -- distinguishable without re-reading them.
  ADD COLUMN IF NOT EXISTS sam_parser_version text,
  -- Commit SHA of the code that wrote the row. Provenance rule: a stored value should be
  -- traceable to the code that produced it, not inferred from timing.
  ADD COLUMN IF NOT EXISTS sam_code_version text;

COMMENT ON COLUMN sam_entities.sam_source_object IS
  'Immutable GCS object key of the archive that produced this row (gs://market-assasin-sam-raw/<key>). NULL means the row predates archival or came from a path that does not archive. NULL is NOT a claim that no archive exists — it means this row cannot prove which bytes produced it.';
COMMENT ON COLUMN sam_entities.sam_source_snapshot IS
  'The date the SAM snapshot REPRESENTS, not when it was ingested. A row from the August extract loaded in October carries 2026-08-02.';
COMMENT ON COLUMN sam_entities.sam_parser_version IS
  'Bump on any change to the parser field mapping. Lets a backfill target only rows parsed by superseded logic.';

-- Find every row produced by one archive (re-parse / backfill targeting).
CREATE INDEX IF NOT EXISTS idx_sam_entities_source_object
  ON sam_entities (sam_source_object) WHERE sam_source_object IS NOT NULL;
-- "which snapshots are represented in the table, and how stale is the oldest?"
CREATE INDEX IF NOT EXISTS idx_sam_entities_source_snapshot
  ON sam_entities (sam_source_snapshot) WHERE sam_source_snapshot IS NOT NULL;
