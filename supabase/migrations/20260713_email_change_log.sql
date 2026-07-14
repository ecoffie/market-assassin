-- Email-change audit + resumability log.
--
-- Every self-serve / admin email change writes ONE row per attempt, updated as
-- reKeyAccountEmail (src/lib/mindy/rekey-account-email.ts) progresses. Two jobs:
--   1. AUDIT — a permanent record of who changed which email, when, from where
--      (support + security review; a change-email is an account-takeover vector).
--   2. RESUMABILITY — because the re-key sweeps ~13 tables + KV + Stripe + Auth
--      with no cross-system transaction, a run that dies mid-sweep can be resumed:
--      `status` + `steps` say what already moved, so a re-run finishes the rest
--      instead of double-moving.
--
-- Idempotent — safe to re-run. Eric pastes this into the Supabase SQL editor by
-- hand (CLAUDE.md migration hand-off protocol). Verify live after:
--   select column_name from information_schema.columns where table_name='email_change_log';

CREATE TABLE IF NOT EXISTS email_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_email text NOT NULL,
  new_email text NOT NULL,
  -- Who initiated: 'self_serve' (the user, via verify-click) | 'admin' (support).
  initiated_by text NOT NULL DEFAULT 'self_serve',
  actor_email text,                       -- admin email when initiated_by='admin'
  -- Lifecycle: requested → verified (new-email link clicked) → executing →
  -- completed | failed | blocked_collision (new email already had an account).
  status text NOT NULL DEFAULT 'requested',
  -- The signed verification token's hash (never store the raw token) + expiry.
  verify_token_hash text,
  verify_expires_at timestamptz,
  verified_at timestamptz,
  -- Per-step results from reKeyAccountEmail (jsonb array of {step, ok, rows,...})
  -- so a resume knows exactly what already moved.
  steps jsonb,
  error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Look up the pending change for an email (verify-click resolves by token, but
-- support looks up by either address).
CREATE INDEX IF NOT EXISTS idx_email_change_log_old ON email_change_log(old_email);
CREATE INDEX IF NOT EXISTS idx_email_change_log_new ON email_change_log(new_email);
CREATE INDEX IF NOT EXISTS idx_email_change_log_status ON email_change_log(status, created_at DESC);
-- Verify-click looks the row up by the token hash.
CREATE INDEX IF NOT EXISTS idx_email_change_log_token ON email_change_log(verify_token_hash);
