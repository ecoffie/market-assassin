-- Trial vs Paid Access — per-user trial window + audit (PRD-trial-vs-paid-access.md)
-- Hand-run in Supabase (no in-app DDL). Confirm "Success. No rows returned".
-- Idempotent: safe to re-run.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at  TIMESTAMPTZ,   -- per-user trial expiry (NULL = no trial)
  ADD COLUMN IF NOT EXISTS access_source  TEXT;          -- 'stripe' | 'lifetime' | 'trial' | 'free' (audit trail)

-- Index for the admin split view (count trial-active vs trial-expired fast)
CREATE INDEX IF NOT EXISTS idx_user_profiles_trial_ends_at
  ON user_profiles (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- Reload PostgREST schema cache so the new columns are queryable immediately
NOTIFY pgrst, 'reload schema';
