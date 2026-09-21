-- Mindy Team access flag
--
-- Adds access_team to user_profiles so the Stripe webhook can mark
-- Team purchasers ($499/mo, 5 seats) with a distinct flag from
-- access_briefings. Team is a superset of Pro:
--   - access_team = true  → tier 'team' in verifyMIAccess()
--   - access_briefings = true (also set) → Pro feature gates still
--                                          unlock naturally
--
-- Per-seat invite flow is a separate workstream (TODO-stripe-team-
-- pricing.md Step 6) — for now access_team being true on the buyer's
-- profile is enough for the dashboard to render the Team tier UI.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS access_team BOOLEAN DEFAULT FALSE;

-- Index for the verifyMIAccess() lookup which queries by email +
-- selects only this column. Lightweight; access_team is rare so a
-- partial index would be even better but full is fine for now.
CREATE INDEX IF NOT EXISTS idx_user_profiles_access_team
  ON user_profiles(email)
  WHERE access_team = TRUE;

COMMENT ON COLUMN user_profiles.access_team IS
  'Mindy Team subscriber flag (set by Stripe webhook on team_monthly / team_annual purchases). Implicitly grants access_briefings too. See src/lib/api-auth.ts:hasMindyTeamAccess().';

NOTIFY pgrst, 'reload schema';
