-- Coach Mode add-on ($99/mo) entitlement flag on Pro users.
-- Grants My Clients / Coach access (3-client cap) WITHOUT upgrading the tier.
-- Mirrors access_team; set by the Stripe webhook on add-on purchase.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS access_coach_addon boolean NOT NULL DEFAULT false;

-- Partial index so the coach-access lookup (WHERE access_coach_addon = true) is cheap.
CREATE INDEX IF NOT EXISTS idx_user_profiles_coach_addon
  ON user_profiles (email)
  WHERE access_coach_addon = true;
