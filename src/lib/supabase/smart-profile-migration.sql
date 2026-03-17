-- ============================================================
-- SMART USER PROFILE MIGRATION
-- Enhances briefing personalization with location, certs, behavior
-- Run in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- PART 1: ADD COLUMNS TO user_briefing_profile
-- ============================================================

-- Location/Geographic targeting
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS metro_area TEXT,
  ADD COLUMN IF NOT EXISTS geographic_preference TEXT DEFAULT 'national'; -- 'local', 'regional', 'national'

-- Business attributes
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS cage_code TEXT,
  ADD COLUMN IF NOT EXISTS duns_number TEXT,
  ADD COLUMN IF NOT EXISTS company_size TEXT, -- 'micro', 'small', 'midsize', 'large'
  ADD COLUMN IF NOT EXISTS annual_revenue TEXT, -- '<$1M', '$1M-$5M', '$5M-$25M', '$25M-$100M', '>$100M'
  ADD COLUMN IF NOT EXISTS employee_count TEXT; -- '<10', '10-50', '50-250', '250-500', '>500'

-- Certifications & Set-asides (critical for filtering)
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}', -- ['8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'EDWOSB']
  ADD COLUMN IF NOT EXISTS set_aside_preferences TEXT[] DEFAULT '{}', -- Same values for filtering
  ADD COLUMN IF NOT EXISTS is_verified_8a BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified_sdvosb BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified_wosb BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified_hubzone BOOLEAN DEFAULT FALSE;

-- Capability statement / Experience
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS capability_keywords TEXT[] DEFAULT '{}', -- ['cybersecurity', 'cloud migration', 'IT support']
  ADD COLUMN IF NOT EXISTS past_performance_agencies TEXT[] DEFAULT '{}', -- Agencies they've worked with
  ADD COLUMN IF NOT EXISTS contract_vehicles TEXT[] DEFAULT '{}', -- ['GSA Schedule', 'SEWP', 'CIO-SP3']
  ADD COLUMN IF NOT EXISTS max_contract_size TEXT; -- Dollar threshold they can handle

-- Engagement tracking (learned from behavior)
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 50, -- 0-100, starts neutral
  ADD COLUMN IF NOT EXISTS briefings_opened INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS briefings_clicked INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_briefing_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_click_at TIMESTAMPTZ;

-- Interest signals (learned from clicks/views)
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS clicked_naics TEXT[] DEFAULT '{}', -- NAICS they've clicked on
  ADD COLUMN IF NOT EXISTS clicked_agencies TEXT[] DEFAULT '{}', -- Agencies they've clicked on
  ADD COLUMN IF NOT EXISTS clicked_contractors TEXT[] DEFAULT '{}', -- Contractors they've clicked on
  ADD COLUMN IF NOT EXISTS clicked_opportunities TEXT[] DEFAULT '{}'; -- Opportunity IDs they've clicked

-- Content preferences (learned or explicit)
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS preferred_content_types TEXT[] DEFAULT '{}', -- ['teaming', 'recompete', 'budget', 'rss']
  ADD COLUMN IF NOT EXISTS muted_agencies TEXT[] DEFAULT '{}', -- Agencies they've muted
  ADD COLUMN IF NOT EXISTS muted_naics TEXT[] DEFAULT '{}', -- NAICS they've muted
  ADD COLUMN IF NOT EXISTS min_contract_value INTEGER DEFAULT 0, -- Only show contracts above this
  ADD COLUMN IF NOT EXISTS max_distance_miles INTEGER; -- For local opportunities

-- Profile completeness
ALTER TABLE user_briefing_profile
  ADD COLUMN IF NOT EXISTS profile_completeness INTEGER DEFAULT 10, -- 0-100 percentage
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_profile_update TIMESTAMPTZ;

COMMENT ON COLUMN user_briefing_profile.engagement_score IS 'Learned score 0-100 based on opens, clicks, tool usage. Higher = more engaged.';
COMMENT ON COLUMN user_briefing_profile.clicked_naics IS 'NAICS codes the user has clicked on in briefings. Used to infer interest.';
COMMENT ON COLUMN user_briefing_profile.profile_completeness IS 'Percentage of profile fields filled. Prompts user to complete.';


-- ============================================================
-- PART 2: BRIEFING INTERACTION LOG TABLE
-- Track every click/open for learning
-- ============================================================

CREATE TABLE IF NOT EXISTS briefing_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  briefing_id TEXT NOT NULL, -- References briefing_log
  briefing_date DATE NOT NULL,

  -- Interaction type
  interaction_type TEXT NOT NULL, -- 'open', 'click', 'dismiss', 'save', 'action_taken'

  -- What was clicked
  item_type TEXT, -- 'opportunity', 'contractor', 'recompete', 'news', 'teaming'
  item_id TEXT, -- Opportunity ID, contractor name, etc.
  item_naics TEXT,
  item_agency TEXT,
  item_value NUMERIC, -- Contract value if applicable

  -- Context
  section TEXT, -- 'teaming', 'sblo', 'recompete', 'market_intel', etc.
  position INTEGER, -- Position in list (1st, 2nd, etc.)

  -- Metadata
  device_type TEXT, -- 'desktop', 'mobile', 'tablet'
  referrer TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON briefing_interactions(user_email);
CREATE INDEX IF NOT EXISTS idx_interactions_date ON briefing_interactions(briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_type ON briefing_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_interactions_item ON briefing_interactions(item_type, item_id);

-- RLS
ALTER TABLE briefing_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on briefing_interactions" ON briefing_interactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow insert for all on briefing_interactions" ON briefing_interactions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select for all on briefing_interactions" ON briefing_interactions
  FOR SELECT USING (true);

COMMENT ON TABLE briefing_interactions IS 'Tracks every briefing open, click, and action for learning user preferences';


-- ============================================================
-- PART 3: FUNCTIONS FOR LEARNING
-- ============================================================

-- Function: Update engagement score based on recent activity
CREATE OR REPLACE FUNCTION update_engagement_score(p_email TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_opens INTEGER;
  v_clicks INTEGER;
  v_days_since_last_open INTEGER;
  v_score INTEGER := 50; -- Start neutral
BEGIN
  -- Get recent opens (last 30 days)
  SELECT COUNT(*) INTO v_opens
  FROM briefing_interactions
  WHERE user_email = p_email
    AND interaction_type = 'open'
    AND created_at > NOW() - INTERVAL '30 days';

  -- Get recent clicks (last 30 days)
  SELECT COUNT(*) INTO v_clicks
  FROM briefing_interactions
  WHERE user_email = p_email
    AND interaction_type = 'click'
    AND created_at > NOW() - INTERVAL '30 days';

  -- Days since last open
  SELECT EXTRACT(DAY FROM NOW() - MAX(created_at))::INTEGER INTO v_days_since_last_open
  FROM briefing_interactions
  WHERE user_email = p_email AND interaction_type = 'open';

  -- Calculate score
  -- Base: 50
  -- +2 per open (max +20)
  -- +5 per click (max +30)
  -- -2 per day of inactivity over 7 days (max -30)

  v_score := 50;
  v_score := v_score + LEAST(v_opens * 2, 20);
  v_score := v_score + LEAST(v_clicks * 5, 30);

  IF v_days_since_last_open > 7 THEN
    v_score := v_score - LEAST((v_days_since_last_open - 7) * 2, 30);
  END IF;

  -- Clamp to 0-100
  v_score := GREATEST(0, LEAST(100, v_score));

  -- Update profile
  UPDATE user_briefing_profile
  SET engagement_score = v_score,
      briefings_opened = v_opens,
      briefings_clicked = v_clicks,
      updated_at = NOW()
  WHERE user_email = p_email;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;


-- Function: Learn from click and update profile
CREATE OR REPLACE FUNCTION learn_from_click(
  p_email TEXT,
  p_item_type TEXT,
  p_item_naics TEXT,
  p_item_agency TEXT,
  p_item_id TEXT
)
RETURNS VOID AS $$
BEGIN
  -- Add to clicked arrays (deduped)
  UPDATE user_briefing_profile
  SET
    clicked_naics = CASE
      WHEN p_item_naics IS NOT NULL AND NOT (clicked_naics @> ARRAY[p_item_naics])
      THEN array_append(clicked_naics, p_item_naics)
      ELSE clicked_naics
    END,
    clicked_agencies = CASE
      WHEN p_item_agency IS NOT NULL AND NOT (clicked_agencies @> ARRAY[p_item_agency])
      THEN array_append(clicked_agencies, p_item_agency)
      ELSE clicked_agencies
    END,
    clicked_contractors = CASE
      WHEN p_item_type = 'contractor' AND p_item_id IS NOT NULL AND NOT (clicked_contractors @> ARRAY[p_item_id])
      THEN array_append(clicked_contractors, p_item_id)
      ELSE clicked_contractors
    END,
    clicked_opportunities = CASE
      WHEN p_item_type = 'opportunity' AND p_item_id IS NOT NULL AND NOT (clicked_opportunities @> ARRAY[p_item_id])
      THEN array_append(clicked_opportunities, p_item_id)
      ELSE clicked_opportunities
    END,
    last_click_at = NOW(),
    updated_at = NOW()
  WHERE user_email = p_email;

  -- Also update naics_weights if they keep clicking same NAICS
  IF p_item_naics IS NOT NULL THEN
    UPDATE user_briefing_profile
    SET naics_weights = COALESCE(naics_weights, '{}'::jsonb) ||
        jsonb_build_object(p_item_naics, COALESCE((naics_weights->>p_item_naics)::integer, 0) + 1)
    WHERE user_email = p_email;
  END IF;

  -- Same for agency_weights
  IF p_item_agency IS NOT NULL THEN
    UPDATE user_briefing_profile
    SET agency_weights = COALESCE(agency_weights, '{}'::jsonb) ||
        jsonb_build_object(p_item_agency, COALESCE((agency_weights->>p_item_agency)::integer, 0) + 1)
    WHERE user_email = p_email;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- Function: Calculate profile completeness
CREATE OR REPLACE FUNCTION calculate_profile_completeness(p_email TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_profile RECORD;
  v_score INTEGER := 0;
  v_max_score INTEGER := 100;
BEGIN
  SELECT * INTO v_profile FROM user_briefing_profile WHERE user_email = p_email;

  IF v_profile IS NULL THEN
    RETURN 0;
  END IF;

  -- Email exists: +10
  v_score := 10;

  -- NAICS codes: +15
  IF array_length(v_profile.naics_codes, 1) > 0 THEN
    v_score := v_score + 15;
  END IF;

  -- Target agencies: +10
  IF array_length(v_profile.agencies, 1) > 0 THEN
    v_score := v_score + 10;
  END IF;

  -- Location (state or zip): +10
  IF v_profile.state IS NOT NULL OR v_profile.zip_code IS NOT NULL THEN
    v_score := v_score + 10;
  END IF;

  -- Company name: +5
  IF v_profile.company_name IS NOT NULL THEN
    v_score := v_score + 5;
  END IF;

  -- Certifications: +15
  IF array_length(v_profile.certifications, 1) > 0 THEN
    v_score := v_score + 15;
  END IF;

  -- Capability keywords: +10
  IF array_length(v_profile.capability_keywords, 1) > 0 THEN
    v_score := v_score + 10;
  END IF;

  -- Past performance agencies: +10
  IF array_length(v_profile.past_performance_agencies, 1) > 0 THEN
    v_score := v_score + 10;
  END IF;

  -- Watched companies: +5
  IF array_length(v_profile.watched_companies, 1) > 0 THEN
    v_score := v_score + 5;
  END IF;

  -- Company size: +5
  IF v_profile.company_size IS NOT NULL THEN
    v_score := v_score + 5;
  END IF;

  -- Contract vehicles: +5
  IF array_length(v_profile.contract_vehicles, 1) > 0 THEN
    v_score := v_score + 5;
  END IF;

  -- Update the profile
  UPDATE user_briefing_profile
  SET profile_completeness = v_score,
      updated_at = NOW()
  WHERE user_email = p_email;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- PART 4: UPDATE EXISTING SCHEMA COMMENTS
-- ============================================================

COMMENT ON TABLE user_briefing_profile IS 'Smart user profile for personalized briefings. Combines explicit preferences with learned behavior from clicks/opens.';


-- ============================================================
-- DONE
-- ============================================================

-- New columns added:
-- Location: state, zip_code, metro_area, geographic_preference
-- Business: company_name, cage_code, duns_number, company_size, annual_revenue, employee_count
-- Certs: certifications, set_aside_preferences, is_verified_*
-- Experience: capability_keywords, past_performance_agencies, contract_vehicles, max_contract_size
-- Engagement: engagement_score, briefings_opened/clicked, last_*_at
-- Learned: clicked_naics/agencies/contractors/opportunities
-- Preferences: preferred_content_types, muted_*, min_contract_value, max_distance_miles
-- Meta: profile_completeness, onboarding_completed, last_profile_update

-- New table:
-- briefing_interactions - tracks every open/click for learning

-- New functions:
-- update_engagement_score(email) - recalculates engagement 0-100
-- learn_from_click(email, type, naics, agency, id) - updates profile from click
-- calculate_profile_completeness(email) - calculates profile % complete
