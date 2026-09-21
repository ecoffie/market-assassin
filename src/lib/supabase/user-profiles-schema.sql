-- User Profiles table with access flags for all products
-- Run this in Supabase SQL Editor

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,

  -- Access flags for all products
  access_hunter_pro BOOLEAN DEFAULT FALSE,
  access_content_standard BOOLEAN DEFAULT FALSE,
  access_content_full_fix BOOLEAN DEFAULT FALSE,
  access_assassin_standard BOOLEAN DEFAULT FALSE,
  access_assassin_premium BOOLEAN DEFAULT FALSE,
  access_recompete BOOLEAN DEFAULT FALSE,
  access_contractor_db BOOLEAN DEFAULT FALSE,

  -- License management
  license_key TEXT UNIQUE,
  license_activated_at TIMESTAMPTZ,
  bundle TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_license_key ON user_profiles(license_key);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Service role can do everything (for webhooks and admin)
CREATE POLICY "Service role full access on user_profiles" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- Public can insert (for webhook creating profiles)
CREATE POLICY "Allow insert for all" ON user_profiles
  FOR INSERT WITH CHECK (true);

-- Public can select by email (for access checks)
CREATE POLICY "Allow select by email" ON user_profiles
  FOR SELECT USING (true);

-- Public can update by email (for webhook updates)
CREATE POLICY "Allow update by email" ON user_profiles
  FOR UPDATE USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_user_profiles_updated_at();

-- Comments
COMMENT ON TABLE user_profiles IS 'Stores user access flags for all products';
COMMENT ON COLUMN user_profiles.email IS 'User email (primary lookup key)';
COMMENT ON COLUMN user_profiles.license_key IS 'License key in XXXX-XXXX-XXXX-XXXX format';
COMMENT ON COLUMN user_profiles.bundle IS 'Bundle name if purchased (govcon-starter-bundle, pro-giant-bundle, ultimate-govcon-bundle)';
