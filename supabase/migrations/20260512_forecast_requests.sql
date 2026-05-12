-- Forecast Requests: User requests for missing forecast data
-- Created: May 12, 2026

CREATE TABLE IF NOT EXISTS forecast_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  
  -- Request details
  agency TEXT NOT NULL,
  office TEXT,
  naics_code TEXT,
  description TEXT,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'fulfilled', 'declined')),
  admin_notes TEXT,
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_forecast_requests_user ON forecast_requests(user_email);
CREATE INDEX IF NOT EXISTS idx_forecast_requests_status ON forecast_requests(status);
CREATE INDEX IF NOT EXISTS idx_forecast_requests_agency ON forecast_requests(agency);
CREATE INDEX IF NOT EXISTS idx_forecast_requests_created ON forecast_requests(created_at DESC);

-- RLS
ALTER TABLE forecast_requests ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to forecast_requests"
  ON forecast_requests FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE forecast_requests IS 'User requests for missing forecast/procurement data';
