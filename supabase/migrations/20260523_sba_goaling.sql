-- SBA Small Business Goaling Report cache
--
-- Stores the per-agency breakdown of federal contracting dollars by
-- small-business socioeconomic category. Source: SBA's CKAN portal
-- at data.sba.gov, specifically the "FY23 Federal Contracting Data
-- by Race/Ethnicity" dataset which is a slice of the full Goaling
-- Report.
--
-- Direct CSV:
--   https://data.sba.gov/dataset/3302152a-9ac5-49c9-ba72-c01cab38f01e/resource/b2f16b6c-1780-4e93-abca-1cf8a7c54e72/download/disaggregated_by_agency_fy23.csv
--
-- The data is a fiscal-year snapshot. SBA publishes new fiscal years
-- annually (FY24 should land sometime in mid-2026). When that comes,
-- re-run the import script with a different fiscal_year value; the
-- composite PK keeps rows separated by year.

CREATE TABLE IF NOT EXISTS sba_goaling (
  fiscal_year INT NOT NULL,
  funding_department TEXT NOT NULL,
  -- Socioeconomic category. Vocabulary from the SBA CSV verbatim.
  -- Known values:
  --   - "Asian American Owned Small Business"
  --   - "Black American Owned Small Business"
  --   - "Hispanic American Owned Small Business"
  --   - "Native American Owned Small Business"
  --   - "Subcontinent Asian American Owned Small Business"
  --   - "Other Minority Owned Small Business"
  --   - "Other Small Business"
  --   - "Not a Small Business"
  category TEXT NOT NULL,

  dollars NUMERIC NOT NULL,     -- amount obligated to this category at this agency
  total NUMERIC NOT NULL,       -- total agency obligations across all categories
  pct NUMERIC NOT NULL,         -- dollars / total, 0.0..1.0

  source_dataset TEXT DEFAULT 'data.sba.gov/fy23-federal-contracting-by-race-ethnicity',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (fiscal_year, funding_department, category)
);

-- Lookup pattern: get all 8 categories for an agency in the most
-- recent FY. The fiscal_year DESC orders the typical query first.
CREATE INDEX IF NOT EXISTS idx_sba_goaling_agency
  ON sba_goaling (LOWER(funding_department), fiscal_year DESC);

COMMENT ON TABLE sba_goaling IS
  'Per-agency breakdown of federal contracting dollars by small-business socioeconomic category (SBA Small Business Goaling Report). One row per (fy, agency, category). Powers the AgencyDrawer "Small Business Mix" section.';

NOTIFY pgrst, 'reload schema';
