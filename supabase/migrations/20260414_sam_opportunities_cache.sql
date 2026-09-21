-- SAM.gov Opportunities Cache
-- Stores all active federal opportunities for fast local queries
-- Synced daily via cron job, eliminates API rate limits

CREATE TABLE IF NOT EXISTS sam_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Core identifiers
  notice_id TEXT NOT NULL UNIQUE,
  solicitation_number TEXT,

  -- Title and description
  title TEXT NOT NULL,
  description TEXT,

  -- Classification
  naics_code TEXT,  -- Primary NAICS
  naics_codes TEXT[], -- All NAICS codes if multiple
  psc_code TEXT,     -- Product/Service Code

  -- Agency info
  department TEXT,
  sub_tier TEXT,
  office TEXT,
  agency_hierarchy TEXT, -- Full path for search

  -- Dates
  posted_date TIMESTAMPTZ,
  response_deadline TIMESTAMPTZ,
  archive_date TIMESTAMPTZ,
  last_modified TIMESTAMPTZ,

  -- Set-aside info
  set_aside_code TEXT,
  set_aside_description TEXT,

  -- Notice type
  notice_type TEXT,  -- 'Solicitation', 'Combined Synopsis', 'Sources Sought', etc.
  notice_type_code TEXT, -- 'o', 'k', 's', 'p', 'r', 'i'
  active BOOLEAN DEFAULT true,

  -- Location
  pop_city TEXT,
  pop_state TEXT,
  pop_zip TEXT,
  pop_country TEXT,

  -- Award info (if available)
  award_amount DECIMAL(15,2),
  award_date TIMESTAMPTZ,
  awardee_name TEXT,
  awardee_uei TEXT,

  -- Links
  ui_link TEXT,

  -- Raw data for anything we might need later
  raw_data JSONB,

  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'sam.gov',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast briefing queries
CREATE INDEX IF NOT EXISTS idx_sam_opps_naics ON sam_opportunities(naics_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_naics_prefix ON sam_opportunities(LEFT(naics_code, 3));
CREATE INDEX IF NOT EXISTS idx_sam_opps_set_aside ON sam_opportunities(set_aside_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_response_deadline ON sam_opportunities(response_deadline);
CREATE INDEX IF NOT EXISTS idx_sam_opps_notice_type ON sam_opportunities(notice_type_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_active ON sam_opportunities(active);
CREATE INDEX IF NOT EXISTS idx_sam_opps_pop_state ON sam_opportunities(pop_state);
CREATE INDEX IF NOT EXISTS idx_sam_opps_department ON sam_opportunities(department);
CREATE INDEX IF NOT EXISTS idx_sam_opps_synced_at ON sam_opportunities(synced_at);

-- Composite index for common briefing query pattern
CREATE INDEX IF NOT EXISTS idx_sam_opps_briefing_query
  ON sam_opportunities(active, naics_code, response_deadline)
  WHERE active = true AND response_deadline > NOW();

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_sam_opps_title_search
  ON sam_opportunities USING gin(to_tsvector('english', title));

-- Track sync runs
CREATE TABLE IF NOT EXISTS sam_sync_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed'

  -- Stats
  total_fetched INTEGER DEFAULT 0,
  new_records INTEGER DEFAULT 0,
  updated_records INTEGER DEFAULT 0,
  deleted_records INTEGER DEFAULT 0,

  -- Error tracking
  error_message TEXT,

  -- Performance
  duration_seconds INTEGER,
  api_calls_made INTEGER DEFAULT 0
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sam_opportunities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS sam_opportunities_updated_at ON sam_opportunities;
CREATE TRIGGER sam_opportunities_updated_at
  BEFORE UPDATE ON sam_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION update_sam_opportunities_updated_at();

-- Enable RLS
ALTER TABLE sam_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sam_sync_runs ENABLE ROW LEVEL SECURITY;

-- Allow read access (opportunities are public data)
CREATE POLICY "Allow public read sam_opportunities" ON sam_opportunities
  FOR SELECT USING (true);

-- Service role can do everything
CREATE POLICY "Service role full access sam_opportunities" ON sam_opportunities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access sam_sync_runs" ON sam_sync_runs
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE sam_opportunities IS 'Cached SAM.gov opportunities for fast local queries. Synced daily.';
COMMENT ON TABLE sam_sync_runs IS 'Tracks SAM.gov sync job runs for monitoring.';
