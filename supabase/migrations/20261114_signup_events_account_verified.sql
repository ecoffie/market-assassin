-- Signup logging repair (activation Phase 1, approved by Eric 2026-11-14).
--
-- signup_events.account_verified = an account's FIRST verified sign-in, from any door (email setup-password,
-- password, Google, Microsoft, magic link). It is the registration count for the activation dashboard.
-- One row per account: this partial unique index makes a concurrent duplicate insert fail with 23505,
-- which src/lib/signup-events.ts recordAccountVerified() treats as "already recorded".
--
-- ADDITIVE ONLY. No rows have event_type = 'account_verified' before this migration, so the index builds
-- without conflict, and no existing query or row changes. Rollback: DROP INDEX the index below.
CREATE UNIQUE INDEX IF NOT EXISTS signup_events_account_verified_once
  ON public.signup_events (user_email)
  WHERE event_type = 'account_verified';
