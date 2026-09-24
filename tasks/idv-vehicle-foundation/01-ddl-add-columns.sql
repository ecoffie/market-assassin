-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 01 — ADDITIVE DDL: IDV vehicle identity columns on `awards`            ⛔ NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Adds 7 NULLABLE columns. Metadata-only in BigQuery: no rows rewritten, no bytes billed,
-- existing columns / partitioning (RANGE_BUCKET(fiscal_year, 2015..2030) — NOT action_date; verified
-- in INFORMATION_SCHEMA.TABLES.ddl 2026-09-23) / clustering (recipient_uei, recipient_name)
-- unchanged. Every existing row reads NULL for the new columns = "not loaded", never a value.
--
-- Source of every column: the USASpending bulk-download contracts CSV the weekly ingest ALREADY
-- downloads into `awards_ingest_staging` (same column names). No new data source.
--
-- Code coupling (src/lib/awards-ingest/merge-sql.ts `resolveIdvIdentityColumnsMode`):
--   * before this DDL  → the ingest MERGE is byte-identical to today's 41-column statement
--   * after this DDL   → the next ingest MERGE writes the 7 columns for its whole window
--   * partial DDL      → the ingest REFUSES to run (never silently half-writes)
--
-- TARGET RESOLUTION: the table is written UNQUALIFIED (`awards`) and resolved by the job's DEFAULT
-- DATASET, so the exact same bytes run against production and against a validation clone:
--   production : bq --project_id=market-assasin query --nouse_legacy_sql --dataset_id=market-assasin:usaspending < <this file>
--   validation : same file, default dataset = a scratch dataset holding a CLONE named `awards`
-- Run (after Eric approves):
--   bq --project_id=market-assasin query --nouse_legacy_sql --dataset_id=market-assasin:usaspending < tasks/idv-vehicle-foundation/01-ddl-add-columns.sql
-- Verify:
--   SELECT column_name, data_type FROM `market-assasin.usaspending.INFORMATION_SCHEMA.COLUMNS`
--   WHERE table_name = 'awards' AND column_name IN ('solicitation_identifier','ordering_period_end_date',
--     'award_or_idv_flag','idv_type_code','multiple_or_single_award_idv_code','parent_award_agency_id',
--     'parent_award_single_or_multiple_code');   -- expect exactly 7 rows
-- Rollback: 99-rollback.sql §A.
--
-- ⚠️ After this lands, the FULL REBUILD (scripts/usaspending-ingest/build-derived.sql, CREATE OR
-- REPLACE TABLE awards) must select these 7 columns or it would silently drop them. It does (see
-- src/lib/awards-ingest/awards-schema.ts + awards-schema-parity.unit.test.ts), and its step-0 ASSERT
-- refuses to run if the live table has any column outside the canonical 58. In the commit AFTER this
-- DDL is verified, flip IDV_IDENTITY_REQUIRED to true in awards-schema.ts.

ALTER TABLE awards
  ADD COLUMN IF NOT EXISTS solicitation_identifier STRING
    OPTIONS (description = 'FPDS solicitation id as reported on THIS transaction (CSV solicitation_identifier). Groups the holder IDVs of one multiple-award program. Per-transaction; award-level value = latest transaction that reports it.'),
  ADD COLUMN IF NOT EXISTS ordering_period_end_date DATE
    OPTIONS (description = 'IDV last date to order as reported on THIS transaction (CSV ordering_period_end_date). The vehicle recompete signal; pop_end_date is NULL on IDV rows.'),
  ADD COLUMN IF NOT EXISTS award_or_idv_flag STRING
    OPTIONS (description = 'CSV award_or_idv_flag: IDV | AWARD.'),
  ADD COLUMN IF NOT EXISTS idv_type_code STRING
    OPTIONS (description = 'CSV idv_type_code (A GWAC, B IDC, C FSS, D BOA, E BPA) on IDV rows.'),
  ADD COLUMN IF NOT EXISTS multiple_or_single_award_idv_code STRING
    OPTIONS (description = 'CSV multiple_or_single_award_idv_code: M | S on IDV rows.'),
  ADD COLUMN IF NOT EXISTS parent_award_agency_id STRING
    OPTIONS (description = 'CSV parent_award_agency_id on orders. Canonical parent = CONT_IDV_<parent_piid>_<parent_award_agency_id>.'),
  ADD COLUMN IF NOT EXISTS parent_award_single_or_multiple_code STRING
    OPTIONS (description = 'CSV parent_award_single_or_multiple_code on orders: M | S.');
