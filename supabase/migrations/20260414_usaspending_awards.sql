-- USASpending Awards Table
-- Stores contract award data with winners and amounts from USASpending.gov
-- Complements SAM.gov opportunities data

CREATE TABLE IF NOT EXISTS usaspending_awards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  award_id TEXT NOT NULL UNIQUE,
  recipient_name TEXT NOT NULL,
  award_amount DECIMAL(15,2),
  awarding_agency TEXT,
  awarding_sub_agency TEXT,
  contract_type TEXT,
  naics_code TEXT,
  naics_description TEXT,
  pop_state TEXT,
  start_date DATE,
  end_date DATE,
  description TEXT,
  usaspending_id TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_usaspending_naics ON usaspending_awards(naics_code);
CREATE INDEX IF NOT EXISTS idx_usaspending_recipient ON usaspending_awards(recipient_name);
CREATE INDEX IF NOT EXISTS idx_usaspending_amount ON usaspending_awards(award_amount DESC);
CREATE INDEX IF NOT EXISTS idx_usaspending_agency ON usaspending_awards(awarding_agency);
CREATE INDEX IF NOT EXISTS idx_usaspending_state ON usaspending_awards(pop_state);
CREATE INDEX IF NOT EXISTS idx_usaspending_start_date ON usaspending_awards(start_date DESC);

-- Events extracted from SAM.gov Special Notices
CREATE TABLE IF NOT EXISTS sam_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notice_id TEXT NOT NULL,
  title TEXT NOT NULL,
  event_type TEXT, -- 'industry_day', 'rfi', 'forecast', 'webinar', 'other'
  agency TEXT,
  event_date DATE,
  event_location TEXT,
  description TEXT,
  registration_url TEXT,
  contact_info TEXT,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  source_notice_type TEXT, -- 'Special Notice', 'Presolicitation', etc.
  CONSTRAINT unique_event_notice UNIQUE (notice_id)
);

CREATE INDEX IF NOT EXISTS idx_sam_events_type ON sam_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sam_events_date ON sam_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_sam_events_agency ON sam_events(agency);
