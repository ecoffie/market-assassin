-- MI Beta Phase: 21-Day Free Trial System
-- Created: April 17, 2026
-- Purpose: Enable post-beta trial system for new users

-- Add trial columns to user_notification_settings
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_status TEXT DEFAULT 'none' CHECK (trial_status IN ('none', 'active', 'expired', 'converted'));

-- Add index for trial expiration queries
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_trial_end
ON user_notification_settings(trial_end_date)
WHERE trial_status = 'active';

-- Add beta_end tracking to know who was grandfathered
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS beta_ended_at TIMESTAMPTZ;

-- Function to start a 21-day trial for a user
CREATE OR REPLACE FUNCTION start_user_trial(p_email TEXT)
RETURNS JSONB AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_trial_end TIMESTAMPTZ := v_now + INTERVAL '21 days';
  v_result JSONB;
BEGIN
  UPDATE user_notification_settings
  SET
    trial_start_date = v_now,
    trial_end_date = v_trial_end,
    trial_status = 'active'
  WHERE email = p_email
  AND trial_status = 'none'
  RETURNING jsonb_build_object(
    'email', email,
    'trial_start_date', trial_start_date,
    'trial_end_date', trial_end_date,
    'trial_status', trial_status
  ) INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('error', 'User not found or already has trial'));
END;
$$ LANGUAGE plpgsql;

-- Function to expire trials
CREATE OR REPLACE FUNCTION expire_trials()
RETURNS TABLE(email TEXT, expired_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  UPDATE user_notification_settings
  SET trial_status = 'expired'
  WHERE trial_status = 'active'
  AND trial_end_date < NOW()
  RETURNING user_notification_settings.email, NOW() as expired_at;
END;
$$ LANGUAGE plpgsql;

-- Function to mark beta participants (run once before beta ends)
CREATE OR REPLACE FUNCTION mark_beta_participants()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_notification_settings
  SET
    beta_participant = true,
    beta_ended_at = NOW()
  WHERE beta_participant = false
  AND (briefings_enabled = true OR alerts_enabled = true);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Comment explaining the trial system
COMMENT ON COLUMN user_notification_settings.trial_start_date IS 'When the 21-day trial started';
COMMENT ON COLUMN user_notification_settings.trial_end_date IS 'When the 21-day trial ends (trial_start_date + 21 days)';
COMMENT ON COLUMN user_notification_settings.trial_status IS 'Trial status: none (no trial), active (in trial), expired (trial ended), converted (became paid)';
COMMENT ON COLUMN user_notification_settings.beta_participant IS 'Was user active during beta period (grandfathered)';
COMMENT ON COLUMN user_notification_settings.beta_ended_at IS 'When beta ended for this user (April 27, 2026)';
