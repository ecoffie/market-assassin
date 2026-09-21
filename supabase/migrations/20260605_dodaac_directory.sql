-- DoDAAC Directory — the reference table that turns office CODES into NAMES.
-- =================================================================
-- The Fortune-1000 SaaS pattern: the code (DoDAAC) is the stable key; the
-- human-readable office name lives ONCE here; everything (Decision Makers,
-- Forecasts, CRM/Target List) joins to it. Users never decode a code, and a
-- name correction updates everywhere at once.
--
-- Populated from BigQuery awards.awarding_office (FPDS-sourced — the
-- authoritative office name per DoDAAC). Refreshed by
-- scripts/populate-dodaac-directory.mjs.
--
-- HAND-RUN in the Supabase SQL editor (this DB has no in-app DDL).

CREATE TABLE IF NOT EXISTS dodaac_directory (
  dodaac        text PRIMARY KEY,        -- 6-char office code (the FK everything joins on)
  office_name   text NOT NULL,           -- human-readable name (e.g. "NAVSUP Weapon Systems Support")
  agency        text,                    -- parent (Department of Defense)
  sub_agency    text,                    -- branch (Air Force / Navy / Army / DLA …)
  award_count   integer,                 -- how often it appears (popularity / confidence)
  total_obligated numeric,               -- $ scale (for ranking offices)
  source        text DEFAULT 'fpds_awards',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dodaac_directory_subagency ON dodaac_directory (sub_agency);
