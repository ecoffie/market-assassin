-- user_dismissed_targets — Track-Defer-Skip triage flow
--
-- Powers the StartTrackingModal triage UX (May 25, 2026). When a
-- user triages an agency they don't want to actively track, we
-- record it here so the modal doesn't surface it again next time
-- (Skip = forever, Defer = 30-day cooldown).
--
-- Dismissals are scoped by user_email + naics_profile (a stable hash
-- of the user's NAICS codes) so the same user gets different
-- dismissal lists for different NAICS profiles. If the user changes
-- NAICS, fresh dismissal list — old skipped agencies may surface
-- again under the new profile, which is the right behavior (different
-- BD strategy).
--
-- 'reason' is either 'skip' (permanent, defer_until NULL) or 'defer'
-- (temporary, defer_until = NOW + 30d). The triage GET endpoint
-- filters: exclude rows where reason='skip' OR defer_until > NOW.

CREATE TABLE IF NOT EXISTS user_dismissed_targets (
  user_email TEXT NOT NULL,
  office_name TEXT NOT NULL,
  agency_name TEXT,
  sub_agency_name TEXT,
  naics_profile TEXT NOT NULL,        -- stable hash of user's NAICS codes
  reason TEXT NOT NULL,               -- 'skip' or 'defer'
  defer_until TIMESTAMPTZ,            -- only set when reason='defer'
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT user_dismissed_targets_pkey
    PRIMARY KEY (user_email, office_name, naics_profile),
  CONSTRAINT user_dismissed_targets_reason_check
    CHECK (reason IN ('skip', 'defer'))
);

-- Lookup pattern: triage GET reads 'all dismissals for this user +
-- NAICS profile' on every call. PK already covers (user_email,
-- office_name, naics_profile); add a secondary index for the common
-- (user_email, naics_profile) scan so we don't hit the heap for
-- every office check.
--
-- NOTE: Partial index WHERE defer_until > NOW() was rejected by
-- Postgres (NOW() isn't IMMUTABLE — predicate value changes every
-- second, so a static index can't reference it). Filtering by time
-- happens at query time inside /api/app/triage GET instead, which
-- works fine since the table will stay small (one row per user per
-- dismissed office per NAICS profile).
CREATE INDEX IF NOT EXISTS idx_user_dismissed_targets_lookup
  ON user_dismissed_targets (user_email, naics_profile, reason);

-- Cleanup: deferred rows whose cooldown has expired should be eligible
-- to surface again. We don't auto-delete them (the dismissed_at +
-- defer_until history is useful BI signal for product analytics) —
-- the GET endpoint just filters them out with `defer_until > NOW()`.

COMMENT ON TABLE user_dismissed_targets IS
  'Triage-flow dismissals (skip/defer) per user per NAICS profile. Powers StartTrackingModal so users do not see same agency twice. Skip is permanent; defer expires after 30 days. Surface again as eligible once defer_until < NOW().';

NOTIFY pgrst, 'reload schema';
