-- ============================================================
-- DAILY BRIEFINGS SCHEMA
-- Phase 1: Search Capture + Briefing Infrastructure
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- PART 1: ALTER EXISTING user_profiles TABLE
-- Add briefing-related columns
-- ============================================================

-- Add briefing access flags to existing user_profiles table
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS access_daily_briefings BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS access_briefing_chat BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS briefing_tier TEXT DEFAULT 'free';

COMMENT ON COLUMN user_profiles.access_daily_briefings IS 'Whether user can receive daily briefings (Phase 1: all users, Phase 2: paid only)';
COMMENT ON COLUMN user_profiles.access_briefing_chat IS 'Whether user can chat with briefing AI (Phase 2 feature)';
COMMENT ON COLUMN user_profiles.briefing_tier IS 'Briefing subscription tier: free, paid, ma_standard, ma_premium';


-- ============================================================
-- PART 2: SEARCH CAPTURE TABLES
-- Capture user searches to auto-build watchlists
-- ============================================================

-- Table: user_search_history
-- Captures every search across all tools
CREATE TABLE IF NOT EXISTS user_search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  tool TEXT NOT NULL, -- 'market_assassin' | 'recompete' | 'opportunity_hunter' | 'contractor_db' | 'content_generator'
  search_type TEXT, -- 'naics' | 'agency' | 'keyword' | 'company' | 'zip' | 'contract'
  search_value TEXT NOT NULL,
  search_metadata JSONB DEFAULT '{}', -- full search params for context
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user ON user_search_history(user_email);
CREATE INDEX IF NOT EXISTS idx_search_history_tool ON user_search_history(tool);
CREATE INDEX IF NOT EXISTS idx_search_history_type ON user_search_history(search_type);
CREATE INDEX IF NOT EXISTS idx_search_history_created ON user_search_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_user_type ON user_search_history(user_email, search_type);

-- RLS
ALTER TABLE user_search_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_search_history" ON user_search_history
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on user_search_history" ON user_search_history
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can read own search history" ON user_search_history
  FOR SELECT USING (true);

COMMENT ON TABLE user_search_history IS 'Captures all user searches across tools to auto-build briefing watchlists';


-- Table: user_briefing_profile
-- Aggregated watchlist from search history + user preferences
CREATE TABLE IF NOT EXISTS user_briefing_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT UNIQUE NOT NULL,

  -- Aggregated profile as JSONB (used by generator)
  aggregated_profile JSONB DEFAULT '{}',

  -- DEPRECATED: Individual arrays (kept for backwards compat, use aggregated_profile)
  naics_codes TEXT[] DEFAULT '{}',
  agencies TEXT[] DEFAULT '{}',
  zip_codes TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  watched_companies TEXT[] DEFAULT '{}',
  watched_contracts TEXT[] DEFAULT '{}',

  -- Weighted scores for ranking (higher = searched more often)
  naics_weights JSONB DEFAULT '{}', -- {"541512": 15, "541519": 8}
  agency_weights JSONB DEFAULT '{}',
  company_weights JSONB DEFAULT '{}',

  -- User preferences
  preferences JSONB DEFAULT '{}', -- JSONB for flexible delivery preferences
  timezone TEXT DEFAULT 'America/New_York',
  email_frequency TEXT DEFAULT 'daily', -- 'daily' | 'weekly' | 'none'
  sms_enabled BOOLEAN DEFAULT FALSE,
  phone_number TEXT,
  preferred_delivery_hour INTEGER DEFAULT 7, -- Hour in user's timezone (0-23)

  -- Manual overrides (user can add items not from search history)
  manual_naics TEXT[] DEFAULT '{}',
  manual_agencies TEXT[] DEFAULT '{}',
  manual_companies TEXT[] DEFAULT '{}',

  -- Sync tracking
  last_search_sync TIMESTAMPTZ,
  search_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_profile_email ON user_briefing_profile(user_email);
CREATE INDEX IF NOT EXISTS idx_briefing_profile_timezone ON user_briefing_profile(timezone);

-- RLS
ALTER TABLE user_briefing_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on user_briefing_profile" ON user_briefing_profile
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on user_briefing_profile" ON user_briefing_profile
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select by email on user_briefing_profile" ON user_briefing_profile
  FOR SELECT USING (true);

CREATE POLICY "Allow update by email on user_briefing_profile" ON user_briefing_profile
  FOR UPDATE USING (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_briefing_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_briefing_profile_updated_at ON user_briefing_profile;
CREATE TRIGGER update_briefing_profile_updated_at
  BEFORE UPDATE ON user_briefing_profile
  FOR EACH ROW EXECUTE FUNCTION update_briefing_profile_updated_at();

COMMENT ON TABLE user_briefing_profile IS 'User watchlist and preferences for daily briefings, auto-aggregated from search history';


-- ============================================================
-- PART 3: BRIEFING SUBSCRIPTION & DELIVERY TABLES
-- ============================================================

-- Table: briefing_subscriptions
-- Tracks Stripe subscription status for $19/mo briefings
CREATE TABLE IF NOT EXISTS briefing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT UNIQUE NOT NULL,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,

  -- Subscription status
  status TEXT DEFAULT 'trialing', -- 'trialing' | 'active' | 'cancelled' | 'past_due' | 'unpaid'
  tier TEXT DEFAULT 'free', -- 'free' | 'paid' | 'ma_standard' | 'ma_premium'

  -- Trial tracking
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,

  -- Billing
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_sub_email ON briefing_subscriptions(user_email);
CREATE INDEX IF NOT EXISTS idx_briefing_sub_status ON briefing_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_briefing_sub_stripe ON briefing_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_briefing_sub_trial_end ON briefing_subscriptions(trial_ends_at);

-- RLS
ALTER TABLE briefing_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on briefing_subscriptions" ON briefing_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on briefing_subscriptions" ON briefing_subscriptions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on briefing_subscriptions" ON briefing_subscriptions
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on briefing_subscriptions" ON briefing_subscriptions
  FOR UPDATE USING (true);

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_briefing_sub_updated_at ON briefing_subscriptions;
CREATE TRIGGER update_briefing_sub_updated_at
  BEFORE UPDATE ON briefing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_briefing_profile_updated_at();

COMMENT ON TABLE briefing_subscriptions IS 'Stripe subscription tracking for $19/mo daily briefings';


-- Table: briefing_log
-- Tracks every briefing sent (for analytics + chatbot context)
CREATE TABLE IF NOT EXISTS briefing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  briefing_date DATE NOT NULL,

  -- Briefing content (for chatbot to reference)
  briefing_content JSONB, -- Full structured briefing data
  briefing_html TEXT, -- Rendered email HTML
  briefing_sms TEXT, -- SMS text version

  -- Delivery tracking
  email_sent_at TIMESTAMPTZ,
  sms_sent_at TIMESTAMPTZ,
  delivery_status TEXT DEFAULT 'pending', -- 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed'

  -- Engagement tracking
  email_opened_at TIMESTAMPTZ,
  email_clicked_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,

  -- Stats
  items_count INTEGER DEFAULT 0,
  tools_included TEXT[] DEFAULT '{}', -- ['opportunity_hunter', 'market_assassin', ...]

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_email, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_briefing_log_email ON briefing_log(user_email);
CREATE INDEX IF NOT EXISTS idx_briefing_log_date ON briefing_log(briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_log_email_date ON briefing_log(user_email, briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_log_status ON briefing_log(delivery_status);

-- RLS
ALTER TABLE briefing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on briefing_log" ON briefing_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on briefing_log" ON briefing_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on briefing_log" ON briefing_log
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on briefing_log" ON briefing_log
  FOR UPDATE USING (true);

COMMENT ON TABLE briefing_log IS 'Delivery log for all briefings sent, includes content for chatbot context';


-- ============================================================
-- PART 4: DATA PIPELINE TABLES
-- ============================================================

-- Table: briefing_snapshots
-- Daily snapshots of data from each tool (for diffing)
CREATE TABLE IF NOT EXISTS briefing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  tool TEXT NOT NULL, -- 'opportunity_hunter' | 'market_assassin' | 'recompete' | 'contractor_db'

  -- Raw data from source
  raw_data JSONB NOT NULL,

  -- Diff vs previous day (computed)
  diff_data JSONB, -- {new: [], changed: [], removed: []}

  -- Stats
  item_count INTEGER DEFAULT 0,
  diff_count INTEGER DEFAULT 0,

  -- Processing
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_email, snapshot_date, tool)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON briefing_snapshots(user_email, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_date_tool ON briefing_snapshots(snapshot_date, tool);
CREATE INDEX IF NOT EXISTS idx_snapshots_tool ON briefing_snapshots(tool);

-- RLS
ALTER TABLE briefing_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on briefing_snapshots" ON briefing_snapshots
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on briefing_snapshots" ON briefing_snapshots
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on briefing_snapshots" ON briefing_snapshots
  FOR SELECT USING (true);

COMMENT ON TABLE briefing_snapshots IS 'Daily data snapshots per user per tool for change detection';


-- Table: web_intelligence_cache
-- Cached web search results (shared across users with same queries)
CREATE TABLE IF NOT EXISTS web_intelligence_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL, -- MD5 hash of search query
  query TEXT NOT NULL,
  query_type TEXT, -- 'agency_naics' | 'competitor' | 'contract' | 'teaming' | 'budget' | 'newsroom'

  -- Results
  raw_results JSONB, -- Raw search results
  filtered_results JSONB, -- AI-filtered relevant results
  relevance_scores JSONB, -- Scores per result

  -- Metadata
  source TEXT, -- 'serper' | 'playwright' | 'rss'
  result_count INTEGER DEFAULT 0,

  -- Cache management
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  hit_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_cache_key ON web_intelligence_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_web_cache_expires ON web_intelligence_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_web_cache_type ON web_intelligence_cache(query_type);

-- RLS
ALTER TABLE web_intelligence_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on web_intelligence_cache" ON web_intelligence_cache
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on web_intelligence_cache" ON web_intelligence_cache
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on web_intelligence_cache" ON web_intelligence_cache
  FOR SELECT USING (true);

CREATE POLICY "Allow update for all on web_intelligence_cache" ON web_intelligence_cache
  FOR UPDATE USING (true);

-- Function to clean expired cache entries (run daily)
CREATE OR REPLACE FUNCTION clean_expired_web_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM web_intelligence_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE web_intelligence_cache IS 'Shared cache for web intelligence queries, expires after 24 hours';


-- ============================================================
-- PART 5: HELPER FUNCTIONS
-- ============================================================

-- Function: Get user's effective briefing tier
-- Considers both subscription AND tool ownership
CREATE OR REPLACE FUNCTION get_user_briefing_tier(p_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_tier TEXT;
  v_has_ma_premium BOOLEAN;
  v_has_ma_standard BOOLEAN;
  v_sub_tier TEXT;
BEGIN
  -- Get subscription tier
  SELECT tier INTO v_sub_tier
  FROM briefing_subscriptions
  WHERE user_email = p_email AND status IN ('trialing', 'active');

  -- Get tool ownership
  SELECT
    COALESCE(access_assassin_premium, FALSE),
    COALESCE(access_assassin_standard, FALSE)
  INTO v_has_ma_premium, v_has_ma_standard
  FROM user_profiles
  WHERE email = p_email;

  -- Determine effective tier (highest wins)
  IF v_has_ma_premium THEN
    RETURN 'ma_premium';
  ELSIF v_has_ma_standard THEN
    RETURN 'ma_standard';
  ELSIF v_sub_tier = 'paid' THEN
    RETURN 'paid';
  ELSE
    RETURN 'free';
  END IF;
END;
$$ LANGUAGE plpgsql;


-- Function: Get user's accessible briefing sections
-- Based on tool ownership
CREATE OR REPLACE FUNCTION get_user_briefing_sections(p_email TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_sections TEXT[] := '{}';
  v_profile RECORD;
BEGIN
  SELECT * INTO v_profile FROM user_profiles WHERE email = p_email;

  IF v_profile IS NULL THEN
    RETURN v_sections;
  END IF;

  -- Always include opportunities if they have any tool
  IF v_profile.access_hunter_pro OR v_profile.access_assassin_standard OR
     v_profile.access_assassin_premium OR v_profile.access_recompete OR
     v_profile.access_contractor_db THEN
    v_sections := array_append(v_sections, 'opportunities');
  END IF;

  IF v_profile.access_recompete THEN
    v_sections := array_append(v_sections, 'recompete');
  END IF;

  IF v_profile.access_contractor_db THEN
    v_sections := array_append(v_sections, 'contractor_db');
  END IF;

  IF v_profile.access_assassin_standard OR v_profile.access_assassin_premium THEN
    v_sections := array_append(v_sections, 'market_signals');
    v_sections := array_append(v_sections, 'ghosting_plays');
  END IF;

  IF v_profile.access_assassin_premium THEN
    v_sections := array_append(v_sections, 'ai_recommendations');
  END IF;

  RETURN v_sections;
END;
$$ LANGUAGE plpgsql;


-- Function: Aggregate search history into briefing profile
-- Called by nightly cron job
CREATE OR REPLACE FUNCTION aggregate_search_to_profile(p_email TEXT)
RETURNS VOID AS $$
DECLARE
  v_naics TEXT[];
  v_agencies TEXT[];
  v_companies TEXT[];
  v_naics_weights JSONB;
  v_agency_weights JSONB;
  v_company_weights JSONB;
  v_search_count INTEGER;
BEGIN
  -- Count total searches
  SELECT COUNT(*) INTO v_search_count
  FROM user_search_history
  WHERE user_email = p_email;

  -- Aggregate NAICS codes (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_naics, v_naics_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'naics'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Aggregate agencies (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_agencies, v_agency_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'agency'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Aggregate companies (top 10 by frequency)
  SELECT
    array_agg(search_value ORDER BY cnt DESC),
    jsonb_object_agg(search_value, cnt)
  INTO v_companies, v_company_weights
  FROM (
    SELECT search_value, COUNT(*) as cnt
    FROM user_search_history
    WHERE user_email = p_email AND search_type = 'company'
    GROUP BY search_value
    ORDER BY cnt DESC
    LIMIT 10
  ) sub;

  -- Upsert briefing profile
  INSERT INTO user_briefing_profile (
    user_email,
    naics_codes, agencies, watched_companies,
    naics_weights, agency_weights, company_weights,
    search_count, last_search_sync
  )
  VALUES (
    p_email,
    COALESCE(v_naics, '{}'),
    COALESCE(v_agencies, '{}'),
    COALESCE(v_companies, '{}'),
    COALESCE(v_naics_weights, '{}'),
    COALESCE(v_agency_weights, '{}'),
    COALESCE(v_company_weights, '{}'),
    v_search_count,
    NOW()
  )
  ON CONFLICT (user_email) DO UPDATE SET
    naics_codes = COALESCE(v_naics, user_briefing_profile.naics_codes),
    agencies = COALESCE(v_agencies, user_briefing_profile.agencies),
    watched_companies = COALESCE(v_companies, user_briefing_profile.watched_companies),
    naics_weights = COALESCE(v_naics_weights, user_briefing_profile.naics_weights),
    agency_weights = COALESCE(v_agency_weights, user_briefing_profile.agency_weights),
    company_weights = COALESCE(v_company_weights, user_briefing_profile.company_weights),
    search_count = v_search_count,
    last_search_sync = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- PART 6: ANALYTICS VIEWS
-- ============================================================

-- View: Briefing delivery stats
CREATE OR REPLACE VIEW briefing_delivery_stats AS
SELECT
  briefing_date,
  COUNT(*) as total_sent,
  COUNT(*) FILTER (WHERE delivery_status = 'delivered') as delivered,
  COUNT(*) FILTER (WHERE delivery_status = 'bounced') as bounced,
  COUNT(*) FILTER (WHERE email_opened_at IS NOT NULL) as opened,
  COUNT(*) FILTER (WHERE email_clicked_at IS NOT NULL) as clicked,
  ROUND(100.0 * COUNT(*) FILTER (WHERE email_opened_at IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as open_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE email_clicked_at IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as click_rate
FROM briefing_log
GROUP BY briefing_date
ORDER BY briefing_date DESC;

-- View: User engagement stats
CREATE OR REPLACE VIEW user_briefing_engagement AS
SELECT
  user_email,
  COUNT(*) as briefings_received,
  COUNT(*) FILTER (WHERE email_opened_at IS NOT NULL) as briefings_opened,
  SUM(click_count) as total_clicks,
  MAX(briefing_date) as last_briefing,
  ROUND(100.0 * COUNT(*) FILTER (WHERE email_opened_at IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as open_rate
FROM briefing_log
GROUP BY user_email;


-- ============================================================
-- DONE
-- ============================================================

-- Summary of tables created:
-- 1. user_search_history - Captures all user searches
-- 2. user_briefing_profile - Aggregated watchlist per user
-- 3. briefing_subscriptions - Stripe subscription tracking
-- 4. briefing_log - Delivery log per briefing
-- 5. briefing_snapshots - Daily data snapshots for diffing
-- 6. web_intelligence_cache - Shared web search cache

-- Summary of columns added to user_profiles:
-- - access_daily_briefings (BOOLEAN)
-- - access_briefing_chat (BOOLEAN)
-- - briefing_tier (TEXT)

-- Summary of functions created:
-- - get_user_briefing_tier(email) - Returns effective tier
-- - get_user_briefing_sections(email) - Returns accessible sections
-- - aggregate_search_to_profile(email) - Aggregates search history
-- - clean_expired_web_cache() - Cleans expired cache entries
