-- Recompete Intelligence System
-- Tracks expiring federal contracts for recompete opportunities
-- Part of Federal Market Intelligence Phase 4

-- Main recompete opportunities table
CREATE TABLE IF NOT EXISTS recompete_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contract identification
  contract_id TEXT NOT NULL,
  award_id TEXT,
  piid TEXT,

  -- Incumbent information
  incumbent_name TEXT NOT NULL,
  incumbent_uei TEXT,
  incumbent_duns TEXT,

  -- Agency information
  awarding_agency TEXT NOT NULL,
  awarding_sub_agency TEXT,
  awarding_office TEXT,
  awarding_office_code TEXT,
  funding_agency TEXT,

  -- Contract details
  naics_code TEXT,
  naics_description TEXT,
  psc_code TEXT,
  psc_description TEXT,
  description TEXT,

  -- Financial data
  total_obligation DECIMAL(18,2),
  base_and_exercised_options DECIMAL(18,2),
  potential_total_value DECIMAL(18,2),

  -- Dates
  period_of_performance_start DATE,
  period_of_performance_current_end DATE,
  period_of_performance_potential_end DATE,
  last_modified_date DATE,

  -- Location
  place_of_performance_state TEXT,
  place_of_performance_city TEXT,
  place_of_performance_zip TEXT,
  place_of_performance_country TEXT DEFAULT 'USA',

  -- Contract terms
  contract_type TEXT,
  set_aside_type TEXT,
  competition_type TEXT,
  number_of_offers INT,

  -- Option tracking
  options_exercised INT DEFAULT 0,
  options_remaining INT DEFAULT 0,

  -- Computed fields
  estimated_recompete_date DATE,
  lead_time_months INT,
  recompete_likelihood TEXT, -- high, medium, low

  -- Metadata
  data_source TEXT DEFAULT 'usaspending',
  source_url TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(contract_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_recompete_naics ON recompete_opportunities(naics_code);
CREATE INDEX IF NOT EXISTS idx_recompete_psc ON recompete_opportunities(psc_code);
CREATE INDEX IF NOT EXISTS idx_recompete_agency ON recompete_opportunities(awarding_agency);
CREATE INDEX IF NOT EXISTS idx_recompete_state ON recompete_opportunities(place_of_performance_state);
CREATE INDEX IF NOT EXISTS idx_recompete_end_date ON recompete_opportunities(period_of_performance_current_end);
CREATE INDEX IF NOT EXISTS idx_recompete_value ON recompete_opportunities(total_obligation);
CREATE INDEX IF NOT EXISTS idx_recompete_incumbent ON recompete_opportunities(incumbent_name);
CREATE INDEX IF NOT EXISTS idx_recompete_set_aside ON recompete_opportunities(set_aside_type);
CREATE INDEX IF NOT EXISTS idx_recompete_likelihood ON recompete_opportunities(recompete_likelihood);

-- Full text search on description and incumbent
CREATE INDEX IF NOT EXISTS idx_recompete_fts ON recompete_opportunities
  USING gin(to_tsvector('english', COALESCE(description, '') || ' ' || COALESCE(incumbent_name, '')));

-- Sync run tracking
CREATE TABLE IF NOT EXISTS recompete_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running', -- running, completed, failed

  -- Stats
  contracts_fetched INT DEFAULT 0,
  contracts_inserted INT DEFAULT 0,
  contracts_updated INT DEFAULT 0,
  contracts_unchanged INT DEFAULT 0,
  errors TEXT[],

  -- Config used
  naics_filter TEXT[],
  months_ahead INT,
  min_value DECIMAL,

  -- Result
  result JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON recompete_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON recompete_sync_runs(started_at DESC);

-- User recompete watchlist
CREATE TABLE IF NOT EXISTS user_recompete_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  recompete_id UUID NOT NULL REFERENCES recompete_opportunities(id) ON DELETE CASCADE,
  notes TEXT,
  priority TEXT DEFAULT 'medium', -- high, medium, low
  status TEXT DEFAULT 'watching', -- watching, pursuing, won, lost
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_email, recompete_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_recompete_watchlist(user_email);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON user_recompete_watchlist(status);

-- Function to compute recompete likelihood
CREATE OR REPLACE FUNCTION compute_recompete_likelihood(
  end_date DATE,
  options_remaining INT,
  total_value DECIMAL
) RETURNS TEXT AS $$
BEGIN
  -- High: Ending within 12 months, no options left, significant value
  IF end_date <= CURRENT_DATE + INTERVAL '12 months'
     AND COALESCE(options_remaining, 0) = 0
     AND COALESCE(total_value, 0) > 1000000 THEN
    RETURN 'high';
  -- Medium: Ending within 18 months or has few options
  ELSIF end_date <= CURRENT_DATE + INTERVAL '18 months'
        OR COALESCE(options_remaining, 0) <= 1 THEN
    RETURN 'medium';
  -- Low: Far out or many options remaining
  ELSE
    RETURN 'low';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-update computed fields
CREATE OR REPLACE FUNCTION update_recompete_computed_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Compute estimated recompete date (12 months before end)
  NEW.estimated_recompete_date := NEW.period_of_performance_current_end - INTERVAL '12 months';

  -- Compute lead time
  NEW.lead_time_months := EXTRACT(MONTH FROM AGE(NEW.period_of_performance_current_end, CURRENT_DATE))::INT;

  -- Compute likelihood
  NEW.recompete_likelihood := compute_recompete_likelihood(
    NEW.period_of_performance_current_end,
    NEW.options_remaining,
    NEW.total_obligation
  );

  -- Update timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompete_computed ON recompete_opportunities;
CREATE TRIGGER trg_recompete_computed
  BEFORE INSERT OR UPDATE ON recompete_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION update_recompete_computed_fields();

-- View for API queries with formatted data
CREATE OR REPLACE VIEW recompete_opportunities_view AS
SELECT
  id,
  contract_id,
  award_id,
  incumbent_name,
  incumbent_uei,
  awarding_agency,
  awarding_sub_agency,
  awarding_office,
  naics_code,
  SPLIT_PART(naics_code, ' ', 1) as naics_code_clean,
  naics_description,
  psc_code,
  description,
  total_obligation,
  potential_total_value,
  period_of_performance_start,
  period_of_performance_current_end,
  place_of_performance_state,
  place_of_performance_city,
  set_aside_type,
  competition_type,
  number_of_offers,
  options_exercised,
  options_remaining,
  estimated_recompete_date,
  lead_time_months,
  recompete_likelihood,
  -- Formatted values
  TO_CHAR(total_obligation, 'FM$999,999,999,999') as total_obligation_formatted,
  TO_CHAR(period_of_performance_current_end, 'Mon DD, YYYY') as end_date_formatted,
  -- Status flags
  CASE
    WHEN period_of_performance_current_end <= CURRENT_DATE + INTERVAL '6 months' THEN 'urgent'
    WHEN period_of_performance_current_end <= CURRENT_DATE + INTERVAL '12 months' THEN 'soon'
    ELSE 'future'
  END as urgency,
  last_synced_at,
  created_at
FROM recompete_opportunities
WHERE period_of_performance_current_end > CURRENT_DATE;

-- Stats view for dashboard
CREATE OR REPLACE VIEW recompete_stats AS
SELECT
  COUNT(*) as total_contracts,
  SUM(total_obligation) as total_value,
  COUNT(*) FILTER (WHERE recompete_likelihood = 'high') as high_likelihood,
  COUNT(*) FILTER (WHERE recompete_likelihood = 'medium') as medium_likelihood,
  COUNT(*) FILTER (WHERE recompete_likelihood = 'low') as low_likelihood,
  COUNT(*) FILTER (WHERE lead_time_months <= 6) as expiring_6_months,
  COUNT(*) FILTER (WHERE lead_time_months <= 12) as expiring_12_months,
  COUNT(*) FILTER (WHERE lead_time_months <= 18) as expiring_18_months,
  COUNT(DISTINCT awarding_agency) as agencies,
  COUNT(DISTINCT incumbent_name) as incumbents,
  COUNT(DISTINCT naics_code) as naics_codes,
  (SELECT started_at FROM recompete_sync_runs ORDER BY started_at DESC LIMIT 1) as last_sync
FROM recompete_opportunities
WHERE period_of_performance_current_end > CURRENT_DATE;

-- Enable RLS
ALTER TABLE recompete_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recompete_watchlist ENABLE ROW LEVEL SECURITY;

-- Public read access for recompete opportunities (authenticated users)
CREATE POLICY "Authenticated users can view recompete opportunities"
  ON recompete_opportunities FOR SELECT
  USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can manage recompete opportunities"
  ON recompete_opportunities FOR ALL
  USING (auth.role() = 'service_role');

-- Users can manage their own watchlist
CREATE POLICY "Users can manage their own watchlist"
  ON user_recompete_watchlist FOR ALL
  USING (auth.jwt() ->> 'email' = user_email);

COMMENT ON TABLE recompete_opportunities IS 'Expiring federal contracts for recompete tracking - Part of Federal Market Intelligence';
COMMENT ON TABLE recompete_sync_runs IS 'Tracks USASpending sync runs for recompete data';
COMMENT ON TABLE user_recompete_watchlist IS 'User-specific recompete opportunity tracking';
