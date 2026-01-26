-- User Profiles table with access flags for all products
-- Run this in Supabase SQL Editor

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  tier TEXT, -- last purchased tier
  access_hunter_pro BOOLEAN DEFAULT FALSE,
  access_content_standard BOOLEAN DEFAULT FALSE,
  access_content_full_fix BOOLEAN DEFAULT FALSE,
  access_assassin_standard BOOLEAN DEFAULT FALSE,
  access_assassin_premium BOOLEAN DEFAULT FALSE,
  access_recompete BOOLEAN DEFAULT FALSE,
  access_contractor_db BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do everything (for webhooks and admin)
CREATE POLICY "Service role full access on user_profiles" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');

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
COMMENT ON COLUMN user_profiles.tier IS 'Last purchased tier: hunter_pro, content_full_fix, assassin_premium, etc.';
