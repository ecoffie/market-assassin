-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 02 — TIER A BACKFILL from the CURRENT staging load                     ⛔ NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PROVENANCE (measured read-only 2026-09-23):
--   table     awards_ingest_staging
--   load      last modified 2026-09-20T18:18:42Z (the weekly incremental that also MERGEd awards
--             at 2026-09-20T18:18:56Z)
--   contents  855,543 rows, action_date 2026-06-03 .. 2026-09-18, 72,024 IDV transaction rows
--             (47,901 distinct IDVs; 41,836 with a solicitation id on ≥1 of those transactions)
--   columns   solicitation_identifier, ordering_period_end_date, award_or_idv_flag,
--             idv_type_code, multiple_or_single_award_idv_code, parent_award_agency_id,
--             parent_award_single_or_multiple_code  (+ contract_transaction_unique_key as the key)
--   match     every staging txn is present in awards (855,543/855,543 keys; 72,024/72,024 IDV txns)
--
-- REACH — be honest about it: this touches only transactions DATED in that window. It reaches
-- 47,901 of 188,634 IDVs with activity since FY2024 (25.4%), and ZERO of the four Robins
-- Mech-Elec II holders (none of them had an IDV modification in the window). Historical IDV
-- identity needs 03 (re-acquisition from the same USASpending bulk endpoint).
--
-- REDUNDANT BY DESIGN: once 01 has landed, the next weekly ingest MERGE re-pulls this same
-- window and writes these columns itself. Run 02 only if the columns are wanted before that run.
-- It is guarded: the ASSERTs abort (writing nothing) if staging has been replaced by a later load.
--
-- Precondition: 01-ddl-add-columns.sql applied. Take the snapshot in README step 0 first.
-- Scope of the write: only the 7 new columns; no existing column is touched.
-- Dry-run of the source SELECT (below): 0.068 GiB. Target rows: action_date 2026-06-01..2026-09-18 (awards is
-- partitioned RANGE_BUCKET(fiscal_year), not action_date — this bound selects rows, it does not prune partitions).
-- TARGET RESOLUTION: tables are UNQUALIFIED (`awards`, `awards_ingest_staging`) and resolve through
-- the job's DEFAULT DATASET, so production and the validation clone run byte-identical text.
-- Run (after Eric approves):
--   bq --project_id=market-assasin query --nouse_legacy_sql --dataset_id=market-assasin:usaspending < tasks/idv-vehicle-foundation/02-backfill-from-current-staging.sql

ASSERT (SELECT COUNT(*) FROM awards_ingest_staging) = 855543
  AS 'awards_ingest_staging is no longer the 2026-09-20 load (row count changed) — re-measure before backfilling';
ASSERT (SELECT CAST(MIN(SAFE_CAST(action_date AS DATE)) AS STRING) || '..' || CAST(MAX(SAFE_CAST(action_date AS DATE)) AS STRING)
        FROM awards_ingest_staging) = '2026-06-03..2026-09-18'
  AS 'awards_ingest_staging window changed — re-measure before backfilling';

UPDATE awards T
SET
  solicitation_identifier              = S.solicitation_identifier,
  ordering_period_end_date             = S.ordering_period_end_date,
  award_or_idv_flag                    = S.award_or_idv_flag,
  idv_type_code                        = S.idv_type_code,
  multiple_or_single_award_idv_code    = S.multiple_or_single_award_idv_code,
  parent_award_agency_id               = S.parent_award_agency_id,
  parent_award_single_or_multiple_code = S.parent_award_single_or_multiple_code
FROM (
  SELECT
    CAST(contract_transaction_unique_key AS STRING) AS txn_id,
    CAST(NULLIF(solicitation_identifier, '') AS STRING) AS solicitation_identifier,
    SAFE_CAST(NULLIF(ordering_period_end_date, '') AS DATE) AS ordering_period_end_date,
    CAST(NULLIF(award_or_idv_flag, '') AS STRING) AS award_or_idv_flag,
    CAST(NULLIF(idv_type_code, '') AS STRING) AS idv_type_code,
    CAST(NULLIF(multiple_or_single_award_idv_code, '') AS STRING) AS multiple_or_single_award_idv_code,
    CAST(NULLIF(parent_award_agency_id, '') AS STRING) AS parent_award_agency_id,
    CAST(NULLIF(parent_award_single_or_multiple_code, '') AS STRING) AS parent_award_single_or_multiple_code
  FROM awards_ingest_staging
  WHERE IFNULL(contract_transaction_unique_key, '') != ''
  -- UPDATE … FROM needs ≤1 source row per target row.
  QUALIFY ROW_NUMBER() OVER (PARTITION BY contract_transaction_unique_key ORDER BY last_modified_date DESC) = 1
) S
WHERE T.txn_id = S.txn_id
  AND T.action_date BETWEEN '2026-06-01' AND '2026-09-18';

-- Verify (expect idv_rows_with_ordering_end = 72,024 and idv_rows_with_sol = 63,660):
-- SELECT COUNTIF(award_or_idv_flag = 'IDV') AS idv_rows,
--        COUNTIF(award_or_idv_flag = 'IDV' AND ordering_period_end_date IS NOT NULL) AS idv_rows_with_ordering_end,
--        COUNTIF(award_or_idv_flag = 'IDV' AND solicitation_identifier IS NOT NULL) AS idv_rows_with_sol
-- FROM `market-assasin.usaspending.awards` WHERE action_date BETWEEN '2026-06-01' AND '2026-09-18';
