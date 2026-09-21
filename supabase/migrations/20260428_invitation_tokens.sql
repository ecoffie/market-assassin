-- Invitation Tokens for Magic Link Signup
-- Created: April 28, 2026
-- Purpose: Track magic link invitations for paid subscribers without accounts

-- Create invitation_tokens table
CREATE TABLE IF NOT EXISTS invitation_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT,
    product_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_token ON invitation_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_email ON invitation_tokens(email);
CREATE INDEX IF NOT EXISTS idx_invitation_tokens_stripe_customer ON invitation_tokens(stripe_customer_id);

-- Comments
COMMENT ON TABLE invitation_tokens IS 'Magic link invitation tokens for paid subscribers to create alert accounts';
COMMENT ON COLUMN invitation_tokens.token IS 'Base64url-encoded token containing customer_id:timestamp:hmac';
COMMENT ON COLUMN invitation_tokens.used_at IS 'Timestamp when the user completed signup using this token';
COMMENT ON COLUMN invitation_tokens.expires_at IS 'Token expiration (30 days from creation)';

-- =============================================================================
-- Add invitation tracking fields to user_notification_settings
-- =============================================================================
-- These fields distinguish:
--   1. paid_existing users who matched on first dry run (already engaged)
--   2. paid_existing users who came via invitation campaign (newly activated)

ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS invitation_source TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Index for cohort analysis queries
CREATE INDEX IF NOT EXISTS idx_user_notif_invitation_source
ON user_notification_settings(invitation_source)
WHERE invitation_source IS NOT NULL;

-- Index for Stripe customer lookup
CREATE INDEX IF NOT EXISTS idx_user_notif_stripe_customer
ON user_notification_settings(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_notification_settings.invitation_sent_at IS 'When the magic link invitation was sent (null = matched on dry run)';
COMMENT ON COLUMN user_notification_settings.invitation_source IS 'How user was activated: "dry_run_match" (already had account) or "invitation_campaign" (activated via email)';
COMMENT ON COLUMN user_notification_settings.stripe_customer_id IS 'Stripe customer ID for paid subscribers (enables cross-referencing with Stripe data)';
