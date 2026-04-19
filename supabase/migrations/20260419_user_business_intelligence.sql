-- User Business Intelligence Table
-- Stores business descriptions, calibration data, and behavioral signals
-- Used for: Better matching, customer insights, product intelligence

-- Table for storing user business profile data
CREATE TABLE IF NOT EXISTS user_business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Business Description (from calibration wizard)
  business_description TEXT,
  business_description_updated_at TIMESTAMPTZ,

  -- Extracted Profile (from opportunity selections)
  extracted_naics_codes JSONB DEFAULT '[]'::jsonb,  -- [{code, name, count}]
  extracted_psc_codes JSONB DEFAULT '[]'::jsonb,     -- [{code, count}]
  extracted_keywords JSONB DEFAULT '[]'::jsonb,      -- [string]
  extracted_agencies JSONB DEFAULT '[]'::jsonb,      -- [{name, count}]
  extracted_set_asides JSONB DEFAULT '[]'::jsonb,    -- [{code, description, count}]

  -- Calibration Metadata
  opportunities_shown INTEGER DEFAULT 0,
  opportunities_selected INTEGER DEFAULT 0,
  selected_opportunity_ids JSONB DEFAULT '[]'::jsonb,
  calibration_completed_at TIMESTAMPTZ,

  -- Inferred Business Attributes
  inferred_company_size TEXT,          -- small, medium, large (from description analysis)
  inferred_business_type TEXT,         -- services, products, construction, tech, etc.
  inferred_certifications TEXT[],      -- 8a, HUBZone, WOSB, SDVOSB, etc.

  -- Behavioral Signals
  tools_used TEXT[] DEFAULT '{}',              -- market_assassin, content_reaper, etc.
  reports_generated INTEGER DEFAULT 0,
  opportunities_viewed INTEGER DEFAULT 0,
  opportunities_added_to_pipeline INTEGER DEFAULT 0,
  last_activity_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_business_profile UNIQUE (user_email)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_business_profiles_email ON user_business_profiles(user_email);
CREATE INDEX IF NOT EXISTS idx_user_business_profiles_updated ON user_business_profiles(updated_at DESC);

-- Add business_description column to user_notification_settings if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_notification_settings'
    AND column_name = 'business_description'
  ) THEN
    ALTER TABLE user_notification_settings ADD COLUMN business_description TEXT;
  END IF;
END $$;

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_user_business_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS user_business_profile_updated ON user_business_profiles;
CREATE TRIGGER user_business_profile_updated
  BEFORE UPDATE ON user_business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_business_profile_timestamp();

-- Comment for documentation
COMMENT ON TABLE user_business_profiles IS 'Stores business intelligence about users for better matching and product insights';
COMMENT ON COLUMN user_business_profiles.business_description IS 'Free-text description from calibration wizard';
COMMENT ON COLUMN user_business_profiles.extracted_naics_codes IS 'NAICS codes extracted from opportunity selections';
COMMENT ON COLUMN user_business_profiles.tools_used IS 'Array of tool names the user has accessed';
