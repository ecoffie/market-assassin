-- Budget Intelligence System Tables
-- Migration: 20260405_budget_intelligence.sql
-- Purpose: Store budget programs, pain points, and NAICS mappings for early opportunity identification

-- ============================================================================
-- TABLE: budget_programs
-- Individual line items from Congressional Budget Justifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Source identification
  agency TEXT NOT NULL,
  sub_agency TEXT,
  fiscal_year INTEGER NOT NULL,
  document_url TEXT,
  page_reference TEXT,

  -- Program details
  program_name TEXT NOT NULL,
  program_code TEXT,
  description TEXT,

  -- Funding
  requested_amount NUMERIC(15,2),
  enacted_amount NUMERIC(15,2),
  prior_year_amount NUMERIC(15,2),
  funding_trend TEXT CHECK (funding_trend IN ('surging', 'growing', 'stable', 'declining', 'cut', 'new')),

  -- Classification
  keywords TEXT[],
  naics_codes TEXT[],
  psc_codes TEXT[],
  category TEXT CHECK (category IN ('cybersecurity', 'infrastructure', 'modernization', 'compliance', 'workforce', 'logistics', 'research', 'operations', 'other')),

  -- Intelligence
  procurement_likelihood NUMERIC(3,2) CHECK (procurement_likelihood >= 0 AND procurement_likelihood <= 1),
  estimated_rfp_quarter TEXT,
  contract_type_likely TEXT,
  set_aside_likely TEXT,

  -- AI extraction metadata
  extraction_method TEXT CHECK (extraction_method IN ('ai', 'manual', 'scrape', 'import')),
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  human_verified BOOLEAN DEFAULT false,

  -- Tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, fiscal_year, program_name)
);

-- ============================================================================
-- TABLE: agency_budget_authority
-- FY-level budget trends per agency
-- ============================================================================
CREATE TABLE IF NOT EXISTS agency_budget_authority (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  agency TEXT NOT NULL,
  toptier_code TEXT,

  fiscal_year INTEGER NOT NULL,
  budget_authority NUMERIC(15,2),
  obligated NUMERIC(15,2),
  outlays NUMERIC(15,2),

  -- Trends (compared to prior year)
  prior_year_authority NUMERIC(15,2),
  change_amount NUMERIC(15,2),
  change_percent NUMERIC(5,4),
  trend TEXT CHECK (trend IN ('surging', 'growing', 'stable', 'declining', 'cut')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, fiscal_year)
);

-- ============================================================================
-- TABLE: agency_pain_points_db
-- Persisted pain points (supplements JSON file)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agency_pain_points_db (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  agency TEXT NOT NULL,
  sub_agency TEXT,

  pain_point TEXT NOT NULL,
  category TEXT CHECK (category IN ('cybersecurity', 'infrastructure', 'modernization', 'compliance', 'workforce', 'logistics', 'research', 'operations', 'other')),
  source TEXT CHECK (source IN ('cbj', 'ndaa', 'gao', 'ig_report', 'manual', 'ai_inferred', 'import')),
  source_url TEXT,

  -- NAICS relevance
  naics_codes TEXT[],

  -- Priority and timing
  urgency TEXT CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  estimated_resolution_fy INTEGER,

  -- Tracking
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, pain_point)
);

-- ============================================================================
-- TABLE: agency_priorities_db
-- Specific funding priorities with dollar amounts and timelines
-- ============================================================================
CREATE TABLE IF NOT EXISTS agency_priorities_db (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  agency TEXT NOT NULL,
  sub_agency TEXT,

  priority_description TEXT NOT NULL,
  funding_amount NUMERIC(15,2),
  fiscal_year TEXT, -- Can be 'FY2025-2027' ranges

  -- Classification
  category TEXT,
  naics_codes TEXT[],
  keywords TEXT[],

  -- Opportunity intelligence
  contract_vehicle TEXT,
  opportunity_window TEXT, -- 'Q3 FY2025', 'FY2025-2026'
  set_aside_mentioned TEXT,

  -- Source
  source TEXT,
  source_url TEXT,

  -- Tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(agency, priority_description)
);

-- ============================================================================
-- TABLE: naics_program_mapping
-- Links NAICS codes to budget programs for filtering
-- ============================================================================
CREATE TABLE IF NOT EXISTS naics_program_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  naics_code TEXT NOT NULL,
  naics_description TEXT,

  program_id UUID REFERENCES budget_programs(id) ON DELETE CASCADE,
  agency TEXT NOT NULL,
  program_name TEXT NOT NULL,

  relevance_score NUMERIC(3,2) CHECK (relevance_score >= 0 AND relevance_score <= 1),
  mapping_source TEXT CHECK (mapping_source IN ('ai', 'manual', 'historical', 'import')),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(naics_code, program_id)
);

-- ============================================================================
-- TABLE: budget_intel_sync_runs
-- Track sync/import operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_intel_sync_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  run_type TEXT NOT NULL, -- 'cbj_extraction', 'pain_points_refresh', 'full_sync', 'import'
  agency TEXT, -- NULL for all-agency runs

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),

  -- Results
  programs_added INTEGER DEFAULT 0,
  programs_updated INTEGER DEFAULT 0,
  pain_points_added INTEGER DEFAULT 0,
  priorities_added INTEGER DEFAULT 0,
  mappings_created INTEGER DEFAULT 0,

  error_message TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_budget_programs_agency ON budget_programs(agency);
CREATE INDEX IF NOT EXISTS idx_budget_programs_fy ON budget_programs(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_budget_programs_naics ON budget_programs USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_budget_programs_category ON budget_programs(category);
CREATE INDEX IF NOT EXISTS idx_budget_programs_trend ON budget_programs(funding_trend);

CREATE INDEX IF NOT EXISTS idx_budget_authority_agency ON agency_budget_authority(agency);
CREATE INDEX IF NOT EXISTS idx_budget_authority_fy ON agency_budget_authority(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_budget_authority_trend ON agency_budget_authority(trend);

CREATE INDEX IF NOT EXISTS idx_pain_points_agency ON agency_pain_points_db(agency);
CREATE INDEX IF NOT EXISTS idx_pain_points_naics ON agency_pain_points_db USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_pain_points_category ON agency_pain_points_db(category);

CREATE INDEX IF NOT EXISTS idx_priorities_agency ON agency_priorities_db(agency);
CREATE INDEX IF NOT EXISTS idx_priorities_naics ON agency_priorities_db USING GIN(naics_codes);

CREATE INDEX IF NOT EXISTS idx_naics_mapping_code ON naics_program_mapping(naics_code);
CREATE INDEX IF NOT EXISTS idx_naics_mapping_agency ON naics_program_mapping(agency);

-- ============================================================================
-- VIEW: agency_budget_intel
-- Summary view combining budget authority with programs and pain points
-- ============================================================================
CREATE OR REPLACE VIEW agency_budget_intel AS
SELECT
  ba.agency,
  ba.fiscal_year,
  ba.budget_authority,
  ba.change_percent,
  ba.trend,
  COALESCE(bp.program_count, 0) as program_count,
  COALESCE(bp.total_program_funding, 0) as total_program_funding,
  COALESCE(pp.pain_point_count, 0) as pain_point_count,
  COALESCE(pr.priority_count, 0) as priority_count,
  bp.categories
FROM agency_budget_authority ba
LEFT JOIN (
  SELECT
    agency,
    fiscal_year,
    COUNT(*) as program_count,
    SUM(requested_amount) as total_program_funding,
    ARRAY_AGG(DISTINCT category) FILTER (WHERE category IS NOT NULL) as categories
  FROM budget_programs
  GROUP BY agency, fiscal_year
) bp ON ba.agency = bp.agency AND ba.fiscal_year = bp.fiscal_year
LEFT JOIN (
  SELECT agency, COUNT(*) as pain_point_count
  FROM agency_pain_points_db
  GROUP BY agency
) pp ON ba.agency = pp.agency
LEFT JOIN (
  SELECT agency, COUNT(*) as priority_count
  FROM agency_priorities_db
  GROUP BY agency
) pr ON ba.agency = pr.agency;

-- ============================================================================
-- VIEW: naics_budget_opportunities
-- Programs grouped by NAICS code for opportunity hunting
-- ============================================================================
CREATE OR REPLACE VIEW naics_budget_opportunities AS
SELECT
  nm.naics_code,
  nm.naics_description,
  COUNT(DISTINCT bp.id) as program_count,
  COUNT(DISTINCT bp.agency) as agency_count,
  SUM(bp.requested_amount) as total_funding,
  ARRAY_AGG(DISTINCT bp.agency) as agencies,
  AVG(bp.procurement_likelihood) as avg_procurement_likelihood
FROM naics_program_mapping nm
JOIN budget_programs bp ON nm.program_id = bp.id
WHERE bp.fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE)
GROUP BY nm.naics_code, nm.naics_description
ORDER BY total_funding DESC;

-- ============================================================================
-- FUNCTION: Update timestamp trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION update_budget_intel_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_budget_programs_timestamp ON budget_programs;
CREATE TRIGGER update_budget_programs_timestamp
  BEFORE UPDATE ON budget_programs
  FOR EACH ROW EXECUTE FUNCTION update_budget_intel_timestamp();

DROP TRIGGER IF EXISTS update_budget_authority_timestamp ON agency_budget_authority;
CREATE TRIGGER update_budget_authority_timestamp
  BEFORE UPDATE ON agency_budget_authority
  FOR EACH ROW EXECUTE FUNCTION update_budget_intel_timestamp();

DROP TRIGGER IF EXISTS update_pain_points_timestamp ON agency_pain_points_db;
CREATE TRIGGER update_pain_points_timestamp
  BEFORE UPDATE ON agency_pain_points_db
  FOR EACH ROW EXECUTE FUNCTION update_budget_intel_timestamp();

DROP TRIGGER IF EXISTS update_priorities_timestamp ON agency_priorities_db;
CREATE TRIGGER update_priorities_timestamp
  BEFORE UPDATE ON agency_priorities_db
  FOR EACH ROW EXECUTE FUNCTION update_budget_intel_timestamp();

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT SELECT ON budget_programs TO anon, authenticated;
GRANT SELECT ON agency_budget_authority TO anon, authenticated;
GRANT SELECT ON agency_pain_points_db TO anon, authenticated;
GRANT SELECT ON agency_priorities_db TO anon, authenticated;
GRANT SELECT ON naics_program_mapping TO anon, authenticated;
GRANT SELECT ON budget_intel_sync_runs TO anon, authenticated;
GRANT SELECT ON agency_budget_intel TO anon, authenticated;
GRANT SELECT ON naics_budget_opportunities TO anon, authenticated;

-- Service role gets full access
GRANT ALL ON budget_programs TO service_role;
GRANT ALL ON agency_budget_authority TO service_role;
GRANT ALL ON agency_pain_points_db TO service_role;
GRANT ALL ON agency_priorities_db TO service_role;
GRANT ALL ON naics_program_mapping TO service_role;
GRANT ALL ON budget_intel_sync_runs TO service_role;
