-- Opportunity Shares Table (Viral Growth Feature 1)
-- Tracks shared opportunities for viral referral tracking

CREATE TABLE IF NOT EXISTS opportunity_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id VARCHAR(8) UNIQUE NOT NULL,
  sharer_email VARCHAR(255) NOT NULL,
  sharer_company VARCHAR(255),
  opportunity_id VARCHAR(255) NOT NULL,
  opportunity_title TEXT,
  opportunity_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  view_count INT DEFAULT 0,
  signup_count INT DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_shares_share_id ON opportunity_shares(share_id);
CREATE INDEX IF NOT EXISTS idx_shares_sharer ON opportunity_shares(sharer_email);
CREATE INDEX IF NOT EXISTS idx_shares_opportunity ON opportunity_shares(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_shares_created ON opportunity_shares(created_at DESC);

-- Add company_name and share_attribution to user_notification_settings if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'user_notification_settings'
                 AND column_name = 'company_name') THEN
    ALTER TABLE user_notification_settings ADD COLUMN company_name VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'user_notification_settings'
                 AND column_name = 'share_attribution') THEN
    ALTER TABLE user_notification_settings ADD COLUMN share_attribution BOOLEAN DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'user_notification_settings'
                 AND column_name = 'referral_code') THEN
    ALTER TABLE user_notification_settings ADD COLUMN referral_code VARCHAR(8) UNIQUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'user_notification_settings'
                 AND column_name = 'referred_by') THEN
    ALTER TABLE user_notification_settings ADD COLUMN referred_by VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'user_notification_settings'
                 AND column_name = 'referral_count') THEN
    ALTER TABLE user_notification_settings ADD COLUMN referral_count INT DEFAULT 0;
  END IF;
END $$;

-- User referrals tracking table
CREATE TABLE IF NOT EXISTS user_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email VARCHAR(255) NOT NULL,
  referrer_code VARCHAR(8) NOT NULL,
  referred_email VARCHAR(255) NOT NULL,
  source_type VARCHAR(50), -- 'opportunity_share', 'direct_link', 'email'
  source_id VARCHAR(255), -- shareId if from opportunity share
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  signed_up_at TIMESTAMPTZ,
  converted BOOLEAN DEFAULT FALSE,
  reward_granted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON user_referrals(referrer_email);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON user_referrals(referred_email);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON user_referrals(referrer_code);

-- Enable RLS
ALTER TABLE opportunity_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_referrals ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY IF NOT EXISTS "Service role full access on opportunity_shares" ON opportunity_shares
  FOR ALL USING (true);

CREATE POLICY IF NOT EXISTS "Service role full access on user_referrals" ON user_referrals
  FOR ALL USING (true);

COMMENT ON TABLE opportunity_shares IS 'Tracks shared opportunities for viral referral program';
COMMENT ON TABLE user_referrals IS 'Tracks user referral conversions for rewards program';
