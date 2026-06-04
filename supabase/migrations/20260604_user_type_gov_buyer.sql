-- Government-buyer user type
-- =================================================================
-- A contracting officer is a fundamentally different user than a seller.
-- This column gates the /api/gov-buyer/* route family + the buyer surface.
-- Sellers (default) never see the buyer tool; buyers see only it.
--
-- PRD: docs/PRD-gov-buyer-market-research.md §5
-- Pilot: the two officials are hand-provisioned to 'gov_buyer'
-- (UPDATE user_profiles SET user_type='gov_buyer' WHERE email=...);
-- self-serve .gov/.mil signup comes later.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'seller';
    -- 'seller' | 'gov_buyer'

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_type ON user_profiles(user_type);

COMMENT ON COLUMN user_profiles.user_type IS
  'seller (default) or gov_buyer. Gates the government-buyer market-research surface. See docs/PRD-gov-buyer-market-research.md §5.';
