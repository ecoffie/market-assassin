-- Moat 6: Multi-Site Aggregation Tables
-- Run this SQL in Supabase SQL Editor
-- Created: 2026-04-04

-- ============================================================================
-- 1. AGGREGATED OPPORTUNITIES TABLE
-- Normalized opportunity data from all sources (23+ sites)
-- ============================================================================

CREATE TABLE IF NOT EXISTS aggregated_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source VARCHAR(50) NOT NULL,           -- 'sam_gov', 'dla_dibbs', 'navy_neco', 'nih_reporter', etc.
  external_id VARCHAR(255) NOT NULL,     -- ID from source system
  source_url TEXT,                       -- Direct link to opportunity

  -- Core opportunity data (normalized)
  title TEXT NOT NULL,
  description TEXT,
  agency VARCHAR(255),
  sub_agency VARCHAR(255),

  -- Classification
  naics_code VARCHAR(10),
  psc_code VARCHAR(10),
  set_aside VARCHAR(50),                 -- SBA, 8A, WOSB, SDVOSB, HUBZone, etc.
  opportunity_type VARCHAR(50),          -- solicitation, forecast, baa, grant, etc.

  -- Dates
  posted_date TIMESTAMP WITH TIME ZONE,
  close_date TIMESTAMP WITH TIME ZONE,
  response_date TIMESTAMP WITH TIME ZONE,
  archive_date TIMESTAMP WITH TIME ZONE,

  -- Value
  estimated_value DECIMAL(15, 2),
  award_value DECIMAL(15, 2),

  -- Location
  place_of_performance_state VARCHAR(5),
  place_of_performance_city VARCHAR(100),
  place_of_performance_zip VARCHAR(20),
  place_of_performance_country VARCHAR(50) DEFAULT 'USA',

  -- Contact
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  contracting_office VARCHAR(255),

  -- Documents
  document_urls JSONB DEFAULT '[]',

  -- Status
  status VARCHAR(50) DEFAULT 'active',   -- active, awarded, cancelled, archived

  -- Metadata
  raw_data JSONB,                        -- Original scraped data for debugging
  content_hash VARCHAR(64),              -- SHA256 for change detection

  -- Timestamps
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Deduplication constraint
  UNIQUE(source, external_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agg_opps_naics ON aggregated_opportunities(naics_code);
CREATE INDEX IF NOT EXISTS idx_agg_opps_agency ON aggregated_opportunities(agency);
CREATE INDEX IF NOT EXISTS idx_agg_opps_posted ON aggregated_opportunities(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_agg_opps_close ON aggregated_opportunities(close_date);
CREATE INDEX IF NOT EXISTS idx_agg_opps_status ON aggregated_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_agg_opps_source ON aggregated_opportunities(source);
CREATE INDEX IF NOT EXISTS idx_agg_opps_set_aside ON aggregated_opportunities(set_aside);
CREATE INDEX IF NOT EXISTS idx_agg_opps_type ON aggregated_opportunities(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_agg_opps_scraped ON aggregated_opportunities(scraped_at DESC);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_agg_opps_fts ON aggregated_opportunities
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- ============================================================================
-- 2. MULTISITE SOURCES TABLE
-- Configuration and health tracking for each data source
-- ============================================================================

CREATE TABLE IF NOT EXISTS multisite_sources (
  id VARCHAR(50) PRIMARY KEY,            -- 'dla_dibbs', 'navy_neco', 'nih_reporter', etc.
  name VARCHAR(255) NOT NULL,            -- Human-readable name
  base_url TEXT NOT NULL,                -- Portal URL
  scraper_type VARCHAR(50) NOT NULL,     -- 'api', 'browser', 'rss', 'firecrawl'

  -- Tier for prioritization
  tier INTEGER DEFAULT 3,                -- 1=high-volume, 2=research, 3=labs

  -- Rate limits
  rate_limit_per_minute INTEGER DEFAULT 10,
  rate_limit_per_day INTEGER DEFAULT 500,

  -- Configuration
  config JSONB DEFAULT '{}',             -- Selectors, auth, extraction schema
  headers JSONB DEFAULT '{}',            -- Custom headers

  -- Status & Health
  is_enabled BOOLEAN DEFAULT true,
  last_scrape_at TIMESTAMP WITH TIME ZONE,
  last_scrape_status VARCHAR(50),        -- success, partial, failed
  last_scrape_count INTEGER,
  last_scrape_duration_ms INTEGER,

  -- Health tracking
  consecutive_failures INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  total_scrapes INTEGER DEFAULT 0,
  total_opportunities_found INTEGER DEFAULT 0,

  -- Error tracking
  last_error TEXT,
  last_error_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. SCRAPE LOG TABLE
-- Audit trail for all scrape runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS scrape_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(50) REFERENCES multisite_sources(id),

  -- Run info
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,

  -- Results
  status VARCHAR(50) NOT NULL,           -- running, success, partial, failed
  opportunities_found INTEGER DEFAULT 0,
  opportunities_new INTEGER DEFAULT 0,
  opportunities_updated INTEGER DEFAULT 0,
  opportunities_unchanged INTEGER DEFAULT 0,

  -- Errors
  error_message TEXT,
  error_details JSONB,

  -- Metadata
  triggered_by VARCHAR(50),              -- 'cron', 'manual', 'slash_command', 'mcp'
  params JSONB DEFAULT '{}',             -- Search parameters used

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_log_source ON scrape_log(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_log_status ON scrape_log(status);
CREATE INDEX IF NOT EXISTS idx_scrape_log_started ON scrape_log(started_at DESC);

-- ============================================================================
-- 4. INSERT INITIAL SOURCE CONFIGURATIONS
-- ============================================================================

INSERT INTO multisite_sources (id, name, base_url, scraper_type, tier, rate_limit_per_minute, rate_limit_per_day, config, notes)
VALUES
  -- Tier 1: High-Volume
  ('dla_dibbs', 'DLA DIBBS', 'https://www.dibbs.bsm.dla.mil', 'firecrawl', 1, 5, 200,
   '{"search_url": "/RFQ/RfqRecs.aspx", "extraction_schema": "opportunity"}',
   'Defense Logistics Agency - $41.8B/yr, 10K+ actions/day'),

  ('navy_neco', 'Navy NECO', 'https://www.neco.navy.mil', 'firecrawl', 1, 5, 200,
   '{"search_url": "/synopsis/search", "extraction_schema": "opportunity"}',
   'Navy/Marine Corps opportunities'),

  ('unison', 'Unison Marketplace', 'https://marketplace.unisonglobal.com', 'firecrawl', 1, 10, 500,
   '{"search_url": "/opportunities", "extraction_schema": "opportunity"}',
   'Reverse auctions (formerly FedBid)'),

  ('acq_gateway', 'Acquisition Gateway Forecasts', 'https://acquisitiongateway.gov', 'api', 1, 10, 1000,
   '{"api_url": "https://api.acquisitiongateway.gov/v1/forecasts", "auth": "none"}',
   'Federal procurement forecasts'),

  -- Tier 2: Research/BAAs
  ('nih_reporter', 'NIH RePORTER', 'https://reporter.nih.gov', 'api', 2, 20, 2000,
   '{"api_url": "https://api.reporter.nih.gov/v2/projects/search", "auth": "none"}',
   'NIH funding opportunities - public API'),

  ('darpa_baa', 'DARPA BAAs', 'https://www.darpa.mil/work-with-us/opportunities', 'rss', 2, 60, 1000,
   '{"rss_url": "https://sam.gov/api/prod/sgs/v1/search/?index=opp&q=DARPA&postedFrom=last30days&format=rss"}',
   'DARPA Broad Agency Announcements'),

  ('nsf_sbir', 'NSF SBIR/STTR', 'https://www.nsf.gov/funding', 'rss', 2, 60, 1000,
   '{"rss_url": "https://www.nsf.gov/funding/programs.xml", "filter": "SBIR|STTR"}',
   'NSF Small Business Innovation Research'),

  -- Tier 3: DOE National Labs
  ('ornl', 'Oak Ridge National Lab', 'https://contracts.ornl.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/solicitations/", "portal_type": "ariba"}',
   '$1.2B annual procurement - Ariba portal'),

  ('lanl', 'Los Alamos National Lab', 'https://business.lanl.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/procurement-opportunities/", "portal_type": "custom"}',
   'Strong small business program'),

  ('snl', 'Sandia National Labs', 'https://sandia.gov/working-with-sandia/prospective-suppliers', 'firecrawl', 3, 5, 100,
   '{"search_url": "/business-opportunities/", "portal_type": "custom"}',
   'Annual small business events'),

  ('llnl', 'Lawrence Livermore National Lab', 'https://procurement.llnl.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/opportunities", "portal_type": "custom"}',
   'DOE nuclear security'),

  ('pnnl', 'Pacific Northwest National Lab', 'https://pnnl.gov/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Energy and environment research'),

  ('inl', 'Idaho National Lab', 'https://inl.gov/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Nuclear energy research'),

  ('anl', 'Argonne National Lab', 'https://anl.gov/partnerships/business-opportunities', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Physical sciences research'),

  ('bnl', 'Brookhaven National Lab', 'https://bnl.gov/ppm/procurement.php', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Nuclear and particle physics'),

  ('slac', 'SLAC National Accelerator Lab', 'https://suppliers.slac.stanford.edu', 'firecrawl', 3, 5, 100,
   '{"search_url": "/find-opportunities", "portal_type": "custom"}',
   'Particle physics - $107M to small business FY2025'),

  ('nrel', 'National Renewable Energy Lab', 'https://www.nrel.gov/workingwithus/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom", "note": "Now also nlr.gov"}',
   'Renewable energy - name changed to NLR Dec 2025'),

  ('pppl', 'Princeton Plasma Physics Lab', 'https://procurement.pppl.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/opportunities", "portal_type": "google_sites"}',
   'Fusion research - also uses Google Sites portal'),

  ('srnl', 'Savannah River National Lab', 'https://www.srnl.gov/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "oracle"}',
   'Environmental management - Oracle supplier portal'),

  ('jlab', 'Thomas Jefferson National Lab', 'https://www.jlab.org/finance/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/public_contact", "bulletin_url": "https://misportal.jlab.org/ul/bus_ops/"}',
   'Nuclear physics - also has MISportal'),

  ('ames', 'Ames National Lab', 'https://www.ameslab.gov/about-ames-laboratory/procurement', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Smallest DOE Office of Science lab - $60M budget'),

  ('netl', 'National Energy Technology Lab', 'https://netl-exchange.energy.gov', 'api', 3, 10, 200,
   '{"api_url": "https://netl-exchange.energy.gov/api/opportunities", "portal_type": "exchange"}',
   'Only DOE GOGO lab - has NETL eXCHANGE portal'),

  ('fnal', 'Fermi National Accelerator Lab', 'https://procurement.fnal.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/opportunities/", "portal_type": "custom"}',
   'Particle physics'),

  ('lbnl', 'Lawrence Berkeley National Lab', 'https://procurement.lbl.gov', 'firecrawl', 3, 5, 100,
   '{"search_url": "/", "portal_type": "custom"}',
   'Energy and environmental sciences')

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  scraper_type = EXCLUDED.scraper_type,
  tier = EXCLUDED.tier,
  rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
  rate_limit_per_day = EXCLUDED.rate_limit_per_day,
  config = EXCLUDED.config,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_aggregated_opportunities_updated_at ON aggregated_opportunities;
CREATE TRIGGER update_aggregated_opportunities_updated_at
  BEFORE UPDATE ON aggregated_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_multisite_sources_updated_at ON multisite_sources;
CREATE TRIGGER update_multisite_sources_updated_at
  BEFORE UPDATE ON multisite_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. ADD preferred_sources TO USER NOTIFICATION SETTINGS
-- ============================================================================

ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS preferred_sources TEXT[] DEFAULT ARRAY['sam_gov', 'dla_dibbs', 'navy_neco', 'grants_gov'],
ADD COLUMN IF NOT EXISTS excluded_sources TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN user_notification_settings.preferred_sources IS 'Sources to include in alerts/briefings (default: all major sources)';
COMMENT ON COLUMN user_notification_settings.excluded_sources IS 'Sources to exclude from alerts/briefings';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

SELECT
  'aggregated_opportunities' as table_name,
  COUNT(*) as row_count
FROM aggregated_opportunities
UNION ALL
SELECT
  'multisite_sources' as table_name,
  COUNT(*) as row_count
FROM multisite_sources
UNION ALL
SELECT
  'scrape_log' as table_name,
  COUNT(*) as row_count
FROM scrape_log;
