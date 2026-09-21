-- ============================================================
-- SAVED OPPORTUNITIES SCHEMA
-- User favorites/watchlist for Pursuit Brief generation
-- Run this in Supabase SQL Editor
-- ============================================================

-- Table: user_saved_opportunities
-- Stores opportunities user has saved/favorited
-- Automatically triggers Pursuit Brief generation
CREATE TABLE IF NOT EXISTS user_saved_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Opportunity identifiers
  notice_id TEXT NOT NULL,  -- SAM.gov noticeId
  solicitation_number TEXT, -- SAM.gov solicitation number

  -- Opportunity data (snapshot at time of save)
  opportunity_data JSONB NOT NULL, -- Full opp details
  title TEXT,
  agency TEXT,
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,
  posted_date TIMESTAMPTZ,
  estimated_value NUMERIC,

  -- Source tracking
  source TEXT DEFAULT 'daily_alert', -- 'daily_alert' | 'daily_brief' | 'manual' | 'opportunity_hunter'

  -- Pursuit Brief tracking
  pursuit_brief_requested BOOLEAN DEFAULT TRUE,
  pursuit_brief_sent_at TIMESTAMPTZ,
  pursuit_brief_data JSONB,  -- Generated pursuit brief content

  -- User actions
  status TEXT DEFAULT 'watching', -- 'watching' | 'pursuing' | 'submitted' | 'won' | 'lost' | 'no_bid'
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate saves
  UNIQUE(user_email, notice_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_opps_user ON user_saved_opportunities(user_email);
CREATE INDEX IF NOT EXISTS idx_saved_opps_notice ON user_saved_opportunities(notice_id);
CREATE INDEX IF NOT EXISTS idx_saved_opps_status ON user_saved_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_saved_opps_pursuit_pending ON user_saved_opportunities(user_email)
  WHERE pursuit_brief_requested = TRUE AND pursuit_brief_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_opps_deadline ON user_saved_opportunities(response_deadline);

-- RLS
ALTER TABLE user_saved_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_saved_opportunities" ON user_saved_opportunities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on user_saved_opportunities" ON user_saved_opportunities
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on user_saved_opportunities" ON user_saved_opportunities
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on user_saved_opportunities" ON user_saved_opportunities
  FOR UPDATE USING (true);

CREATE POLICY "Allow delete for all on user_saved_opportunities" ON user_saved_opportunities
  FOR DELETE USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_saved_opps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_saved_opps_updated_at ON user_saved_opportunities;
CREATE TRIGGER update_saved_opps_updated_at
  BEFORE UPDATE ON user_saved_opportunities
  FOR EACH ROW EXECUTE FUNCTION update_saved_opps_updated_at();

COMMENT ON TABLE user_saved_opportunities IS 'User saved/favorited opportunities - triggers Pursuit Brief generation';

-- ============================================================
-- PURSUIT BRIEF LOG
-- Track all pursuit briefs generated
-- ============================================================

CREATE TABLE IF NOT EXISTS pursuit_brief_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  saved_opportunity_id UUID REFERENCES user_saved_opportunities(id),
  notice_id TEXT NOT NULL,

  -- Brief content
  brief_data JSONB NOT NULL,
  opportunity_score INTEGER,

  -- Delivery
  sent_at TIMESTAMPTZ,
  delivery_status TEXT DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  error_message TEXT,

  -- Generation stats
  processing_time_ms INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pursuit_log_user ON pursuit_brief_log(user_email);
CREATE INDEX IF NOT EXISTS idx_pursuit_log_notice ON pursuit_brief_log(notice_id);
CREATE INDEX IF NOT EXISTS idx_pursuit_log_sent ON pursuit_brief_log(sent_at DESC);

-- RLS
ALTER TABLE pursuit_brief_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on pursuit_brief_log" ON pursuit_brief_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on pursuit_brief_log" ON pursuit_brief_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on pursuit_brief_log" ON pursuit_brief_log
  FOR SELECT USING (true);

COMMENT ON TABLE pursuit_brief_log IS 'Log of all pursuit briefs generated and sent';

-- ============================================================
-- DONE
-- ============================================================
-- Tables created:
-- 1. user_saved_opportunities - User's saved/favorited opportunities
-- 2. pursuit_brief_log - Log of pursuit briefs generated
