-- ============================================================================
-- FORECAST INTELLIGENCE SYSTEM
-- Phase 1-4 scalable schema for federal procurement forecasts
-- ============================================================================

-- Main forecasts table - unified schema for all agency sources
CREATE TABLE IF NOT EXISTS agency_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_agency TEXT NOT NULL,                    -- DOE, NASA, DOJ, GSA, VA, etc.
  source_type TEXT NOT NULL DEFAULT 'excel',      -- excel, puppeteer, api
  source_url TEXT,                                -- URL where data was fetched
  external_id TEXT,                               -- Agency's own ID (tracking number, etc.)

  -- Core forecast data
  title TEXT NOT NULL,
  description TEXT,

  -- Agency/Office hierarchy
  department TEXT,                                -- Parent department
  bureau TEXT,                                    -- Sub-agency/bureau
  contracting_office TEXT,
  program_office TEXT,

  -- Classification
  naics_code TEXT,
  naics_description TEXT,
  psc_code TEXT,
  psc_description TEXT,

  -- Timing
  fiscal_year TEXT,                               -- FY2026, FY2027
  anticipated_quarter TEXT,                       -- Q1, Q2, Q3, Q4
  anticipated_award_date DATE,
  solicitation_date DATE,
  performance_end_date DATE,

  -- Value
  estimated_value_min BIGINT,
  estimated_value_max BIGINT,
  estimated_value_range TEXT,                     -- Original text like "R2 – $250K–$7.5M"

  -- Contract details
  contract_type TEXT,                             -- FFP, T&M, IDIQ, BPA, etc.
  set_aside_type TEXT,                            -- SB, 8(a), WOSB, SDVOSB, HUBZone
  competition_type TEXT,                          -- Full & Open, Sole Source, etc.

  -- Incumbent info
  incumbent_name TEXT,
  incumbent_contract_number TEXT,

  -- Contact
  poc_name TEXT,
  poc_email TEXT,
  poc_phone TEXT,

  -- Place of performance
  pop_state TEXT,
  pop_city TEXT,
  pop_zip TEXT,
  pop_country TEXT DEFAULT 'USA',

  -- Status tracking
  status TEXT DEFAULT 'forecast',                 -- forecast, pre-solicitation, solicitation, awarded, cancelled

  -- Metadata
  raw_data JSONB,                                 -- Store original row for debugging
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Deduplication
  UNIQUE(source_agency, external_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_forecasts_naics ON agency_forecasts(naics_code);
CREATE INDEX IF NOT EXISTS idx_forecasts_agency ON agency_forecasts(source_agency);
CREATE INDEX IF NOT EXISTS idx_forecasts_fiscal_year ON agency_forecasts(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_forecasts_set_aside ON agency_forecasts(set_aside_type);
CREATE INDEX IF NOT EXISTS idx_forecasts_state ON agency_forecasts(pop_state);
CREATE INDEX IF NOT EXISTS idx_forecasts_award_date ON agency_forecasts(anticipated_award_date);
CREATE INDEX IF NOT EXISTS idx_forecasts_status ON agency_forecasts(status);
CREATE INDEX IF NOT EXISTS idx_forecasts_naics_prefix ON agency_forecasts(LEFT(naics_code, 4));

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_forecasts_search ON agency_forecasts
  USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')));

-- Track sync operations per source
CREATE TABLE IF NOT EXISTS forecast_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agency TEXT NOT NULL,
  source_type TEXT NOT NULL,                      -- excel, puppeteer, api
  run_type TEXT NOT NULL DEFAULT 'full',          -- full, incremental
  status TEXT NOT NULL DEFAULT 'running',         -- running, completed, failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_fetched INT DEFAULT 0,
  records_added INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  records_unchanged INT DEFAULT 0,
  error_message TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_agency ON forecast_sync_runs(source_agency);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON forecast_sync_runs(status);

-- Source configuration - tracks what sources exist and their health
CREATE TABLE IF NOT EXISTS forecast_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  agency_code TEXT UNIQUE NOT NULL,               -- DOE, NASA, DOJ, GSA, etc.
  agency_name TEXT NOT NULL,

  -- Source details
  source_type TEXT NOT NULL,                      -- excel_direct, puppeteer, api, manual
  source_url TEXT,

  -- Scraper config
  scraper_config JSONB,                           -- Headers, selectors, auth, etc.

  -- Schedule
  sync_frequency TEXT DEFAULT 'weekly',           -- daily, weekly, monthly, manual
  last_sync_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ,

  -- Health
  is_active BOOLEAN DEFAULT true,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INT DEFAULT 0,

  -- Stats
  total_records INT DEFAULT 0,

  -- Coverage estimate
  estimated_spend_coverage DECIMAL(5,2),          -- % of federal procurement

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert known sources
INSERT INTO forecast_sources (agency_code, agency_name, source_type, source_url, estimated_spend_coverage, is_active) VALUES
  ('DOE', 'Department of Energy', 'excel_direct', 'https://www.energy.gov/management/doe-forecast-opportunities', 3.5, true),
  ('NASA', 'NASA', 'excel_direct', 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx', 2.5, true),
  ('DOJ', 'Department of Justice', 'excel_direct', 'https://www.justice.gov/media/1381791/dl', 3.0, true),
  ('GSA', 'General Services Administration', 'puppeteer', 'https://acquisitiongateway.gov/forecast', 8.0, false),
  ('VA', 'Department of Veterans Affairs', 'puppeteer', 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx', 10.0, false),
  ('DHS', 'Department of Homeland Security', 'puppeteer', 'https://apfs-cloud.dhs.gov/forecast/', 8.0, false),
  ('HHS', 'Department of Health and Human Services', 'puppeteer', 'https://procurementforecast.hhs.gov', 12.0, false),
  ('Treasury', 'Department of the Treasury', 'puppeteer', 'https://osdbu.forecast.treasury.gov/', 2.0, false),
  ('EPA', 'Environmental Protection Agency', 'puppeteer', 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast', 1.5, false),
  ('USDA', 'Department of Agriculture', 'puppeteer', 'https://forecast.edc.usda.gov', 4.0, false),
  ('DOD', 'Department of Defense', 'multi_source', NULL, 40.0, false)
ON CONFLICT (agency_code) DO UPDATE SET
  source_url = EXCLUDED.source_url,
  estimated_spend_coverage = EXCLUDED.estimated_spend_coverage;

-- View: Coverage dashboard
CREATE OR REPLACE VIEW forecast_coverage_dashboard AS
SELECT
  fs.agency_code,
  fs.agency_name,
  fs.source_type,
  fs.is_active,
  fs.estimated_spend_coverage,
  fs.total_records,
  fs.last_sync_at,
  fs.consecutive_failures,
  CASE
    WHEN fs.is_active AND fs.last_success_at > NOW() - INTERVAL '7 days' THEN 'healthy'
    WHEN fs.is_active AND fs.last_success_at > NOW() - INTERVAL '30 days' THEN 'stale'
    WHEN fs.is_active THEN 'failing'
    ELSE 'inactive'
  END as health_status
FROM forecast_sources fs
ORDER BY fs.estimated_spend_coverage DESC;

-- View: Forecasts by NAICS with agency counts
CREATE OR REPLACE VIEW forecasts_by_naics AS
SELECT
  naics_code,
  MAX(naics_description) as naics_description,
  COUNT(*) as total_forecasts,
  COUNT(DISTINCT source_agency) as agency_count,
  array_agg(DISTINCT source_agency) as agencies,
  SUM(CASE WHEN set_aside_type IS NOT NULL AND set_aside_type != '' THEN 1 ELSE 0 END) as small_business_count,
  MIN(anticipated_award_date) as earliest_award,
  MAX(anticipated_award_date) as latest_award
FROM agency_forecasts
WHERE naics_code IS NOT NULL AND naics_code != ''
GROUP BY naics_code
ORDER BY total_forecasts DESC;

-- Function: Update source stats after sync
CREATE OR REPLACE FUNCTION update_forecast_source_stats(p_agency_code TEXT)
RETURNS void AS $$
BEGIN
  UPDATE forecast_sources
  SET
    total_records = (SELECT COUNT(*) FROM agency_forecasts WHERE source_agency = p_agency_code),
    updated_at = NOW()
  WHERE agency_code = p_agency_code;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update updated_at
CREATE OR REPLACE FUNCTION update_forecast_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS forecast_updated_at ON agency_forecasts;
CREATE TRIGGER forecast_updated_at
  BEFORE UPDATE ON agency_forecasts
  FOR EACH ROW
  EXECUTE FUNCTION update_forecast_timestamp();

-- ============================================================================
-- RPC FUNCTION: Seed forecast sources (bypasses PostgREST cache)
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_forecast_sources()
RETURNS json AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Upsert all sources
  INSERT INTO forecast_sources (agency_code, agency_name, source_type, source_url, estimated_spend_coverage, is_active, total_records) VALUES
    ('DOE', 'Department of Energy', 'excel_direct', 'https://www.energy.gov/management/doe-forecast-opportunities', 3.5, true, 0),
    ('NASA', 'NASA', 'excel_direct', 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx', 2.5, true, 0),
    ('DOJ', 'Department of Justice', 'excel_direct', 'https://www.justice.gov/media/1381791/dl', 3.0, true, 0),
    ('GSA', 'General Services Administration', 'puppeteer', 'https://acquisitiongateway.gov/forecast', 8.0, false, 0),
    ('VA', 'Department of Veterans Affairs', 'puppeteer', 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx', 10.0, false, 0),
    ('DHS', 'Department of Homeland Security', 'puppeteer', 'https://apfs-cloud.dhs.gov/forecast/', 8.0, false, 0),
    ('HHS', 'Department of Health and Human Services', 'puppeteer', 'https://procurementforecast.hhs.gov', 12.0, false, 0),
    ('Treasury', 'Department of the Treasury', 'puppeteer', 'https://osdbu.forecast.treasury.gov/', 2.0, false, 0),
    ('EPA', 'Environmental Protection Agency', 'puppeteer', 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast', 1.5, false, 0),
    ('USDA', 'Department of Agriculture', 'puppeteer', 'https://forecast.edc.usda.gov', 4.0, false, 0),
    ('DOD', 'Department of Defense', 'multi_source', NULL, 40.0, false, 0)
  ON CONFLICT (agency_code) DO UPDATE SET
    agency_name = EXCLUDED.agency_name,
    source_url = EXCLUDED.source_url,
    estimated_spend_coverage = EXCLUDED.estimated_spend_coverage,
    updated_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Notify PostgREST to reload schema (requires pgrst channel listener)
  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN json_build_object('success', true, 'seeded', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION seed_forecast_sources() TO authenticated;
GRANT EXECUTE ON FUNCTION seed_forecast_sources() TO service_role;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Tables:
--   agency_forecasts      - Main forecast data (unified schema)
--   forecast_sync_runs    - Track sync operations
--   forecast_sources      - Source configuration and health
--
-- Views:
--   forecast_coverage_dashboard - Coverage and health overview
--   forecasts_by_naics          - Aggregated by NAICS code
--
-- Functions:
--   seed_forecast_sources() - Seeds data via RPC (bypasses PostgREST cache)
--
-- Ready for Phase 1-4 expansion:
--   Phase 1: DOE, NASA, DOJ (excel_direct) - 4,729 records
--   Phase 2: GSA Acquisition Gateway (puppeteer) - ~5,000 records
--   Phase 3: VA, DHS, HHS, Treasury (puppeteer) - ~10,000 records
--   Phase 4: DOD multi-source - ~20,000+ records
-- ============================================================================
