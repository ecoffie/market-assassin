-- Email-OTP codes for the paid-MFA login gate (P0) and the existing
-- two-factor/request + two-factor/verify routes.
--
-- WHY THIS EXISTS: the app code (src/lib/mindy/two-factor-code.ts) tried to
-- self-create this table via an `exec_migration` RPC that does not exist in this
-- DB (this DB has no in-app DDL — CLAUDE.md #6). So the table was never created,
-- ensureTwoFactorTable() always failed with 42P01, and the paid-MFA gate
-- fell OPEN (minted a session instead of requiring the code). This migration
-- creates the table for real so the gate can enforce.
--
-- Schema mirrors what two-factor-code.ts INSERTs and two-factor/verify reads:
-- hashed code (never plaintext), 10-min TTL, 60s resend throttle, 5-attempt lockout.

CREATE TABLE IF NOT EXISTS two_factor_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_two_factor_codes_email_created
  ON two_factor_codes(user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_two_factor_codes_expires
  ON two_factor_codes(expires_at);

-- Service-role only (all reads/writes go through the service-role client in the
-- auth routes; no client-side access). Matches every other auth/OTP table here.
ALTER TABLE two_factor_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_two_factor_codes" ON two_factor_codes;
CREATE POLICY "service_role_all_two_factor_codes"
  ON two_factor_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
