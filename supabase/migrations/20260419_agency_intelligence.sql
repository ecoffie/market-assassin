-- Agency Intelligence Tables
-- Stores federal oversight data from public APIs for briefings and market intelligence
-- Created: April 19, 2026

-- Main agency intelligence table
CREATE TABLE IF NOT EXISTS agency_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Agency identification
  agency_name TEXT NOT NULL,
  agency_code TEXT,  -- CGAC code if available
  parent_agency TEXT,

  -- Intelligence data
  intelligence_type TEXT NOT NULL CHECK (intelligence_type IN (
    'gao_high_risk',
    'ig_challenge',
    'budget_priority',
    'it_investment',
    'strategic_goal',
    'contract_pattern',
    'pain_point'
  )),

  -- Content
  title TEXT NOT NULL,
  description TEXT,
  keywords TEXT[],
  fiscal_year INTEGER,

  -- Source tracking (critical for data quality)
  source_name TEXT NOT NULL,  -- e.g., 'GAO', 'OIG', 'IT Dashboard', 'Budget Justification'
  source_url TEXT,
  source_document TEXT,
  publication_date DATE,

  -- Verification
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP WITH TIME ZONE,
  verification_source TEXT,  -- e.g., 'perplexity', 'manual', 'api_response'
  verification_notes TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Prevent duplicates
  UNIQUE(agency_name, intelligence_type, title)
);

-- Index for fast agency lookups
CREATE INDEX IF NOT EXISTS idx_agency_intelligence_agency
  ON agency_intelligence(agency_name);

CREATE INDEX IF NOT EXISTS idx_agency_intelligence_type
  ON agency_intelligence(intelligence_type);

CREATE INDEX IF NOT EXISTS idx_agency_intelligence_keywords
  ON agency_intelligence USING GIN(keywords);

CREATE INDEX IF NOT EXISTS idx_agency_intelligence_fiscal_year
  ON agency_intelligence(fiscal_year);

-- Track data source sync runs
CREATE TABLE IF NOT EXISTS intelligence_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  records_fetched INTEGER DEFAULT 0,
  records_inserted INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_verified INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB
);

-- API provider configuration and health
CREATE TABLE IF NOT EXISTS intelligence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT UNIQUE NOT NULL,
  api_endpoint TEXT,
  api_key_env_var TEXT,
  requires_auth BOOLEAN DEFAULT FALSE,
  rate_limit_per_minute INTEGER DEFAULT 10,
  rate_limit_per_day INTEGER DEFAULT 1000,
  enabled BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status TEXT,
  agency_coverage TEXT[],  -- Which agencies this source covers
  data_types TEXT[],  -- What types of intelligence it provides
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert known data sources
INSERT INTO intelligence_sources (source_name, api_endpoint, requires_auth, data_types, agency_coverage) VALUES
  ('GAO High Risk List', 'https://www.gao.gov/high-risk-list', FALSE,
   ARRAY['gao_high_risk'], ARRAY['all']),
  ('GovInfo API', 'https://api.govinfo.gov', TRUE,
   ARRAY['gao_high_risk', 'budget_priority'], ARRAY['all']),
  ('IT Dashboard', 'https://myit-api.cio.gov/v1', FALSE,
   ARRAY['it_investment'], ARRAY['CFO Act agencies']),
  ('USASpending', 'https://api.usaspending.gov/api/v2', FALSE,
   ARRAY['contract_pattern', 'budget_priority'], ARRAY['all']),
  ('SAM.gov Entity', 'https://api.sam.gov/entity-information/v3', TRUE,
   ARRAY['contract_pattern'], ARRAY['all']),
  ('Perplexity', 'https://api.perplexity.ai', TRUE,
   ARRAY['verification'], ARRAY['all'])
ON CONFLICT (source_name) DO NOTHING;

-- View for agency intelligence with source info
CREATE OR REPLACE VIEW agency_intelligence_full AS
SELECT
  ai.*,
  CASE
    WHEN ai.verified THEN 'Verified'
    WHEN ai.source_url IS NOT NULL THEN 'Sourced'
    ELSE 'Unverified'
  END as verification_status
FROM agency_intelligence ai;

-- Function to get all intelligence for an agency
CREATE OR REPLACE FUNCTION get_agency_intelligence(
  p_agency_name TEXT,
  p_types TEXT[] DEFAULT NULL
)
RETURNS SETOF agency_intelligence AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM agency_intelligence
  WHERE
    (LOWER(agency_name) LIKE LOWER('%' || p_agency_name || '%')
     OR LOWER(parent_agency) LIKE LOWER('%' || p_agency_name || '%'))
    AND (p_types IS NULL OR intelligence_type = ANY(p_types))
  ORDER BY
    CASE intelligence_type
      WHEN 'gao_high_risk' THEN 1
      WHEN 'ig_challenge' THEN 2
      WHEN 'budget_priority' THEN 3
      WHEN 'it_investment' THEN 4
      ELSE 5
    END,
    updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function for briefing pipeline to get relevant intelligence
CREATE OR REPLACE FUNCTION get_intelligence_for_briefing(
  p_naics_codes TEXT[],
  p_agencies TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  agency_name TEXT,
  intelligence_type TEXT,
  title TEXT,
  description TEXT,
  source_name TEXT,
  verified BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ai.agency_name,
    ai.intelligence_type,
    ai.title,
    ai.description,
    ai.source_name,
    ai.verified
  FROM agency_intelligence ai
  WHERE
    (p_agencies IS NULL OR ai.agency_name = ANY(p_agencies) OR ai.parent_agency = ANY(p_agencies))
    AND (ai.fiscal_year IS NULL OR ai.fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE) - 1)
  ORDER BY
    ai.verified DESC,
    ai.updated_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- RLS policies
ALTER TABLE agency_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_sources ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
CREATE POLICY "Allow read access to agency_intelligence"
  ON agency_intelligence FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to intelligence_sync_runs"
  ON intelligence_sync_runs FOR SELECT
  USING (true);

CREATE POLICY "Allow read access to intelligence_sources"
  ON intelligence_sources FOR SELECT
  USING (true);

-- Service role can do everything
CREATE POLICY "Service role full access to agency_intelligence"
  ON agency_intelligence FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to intelligence_sync_runs"
  ON intelligence_sync_runs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to intelligence_sources"
  ON intelligence_sources FOR ALL
  USING (auth.role() = 'service_role');

-- Comment on tables
COMMENT ON TABLE agency_intelligence IS 'Federal agency intelligence data from public APIs (GAO, OIG, IT Dashboard, USASpending)';
COMMENT ON TABLE intelligence_sync_runs IS 'Tracks data synchronization runs from federal APIs';
COMMENT ON TABLE intelligence_sources IS 'Configuration for federal data API sources';
