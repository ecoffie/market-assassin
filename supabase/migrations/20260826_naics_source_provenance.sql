-- NAICS PROVENANCE — distinguish what a user CHOSE from what we guessed or defaulted.
--
-- ── THE MEASUREMENT THAT FORCED THIS (2026-08-25) ─────────────────────────────────────
-- Of 9,778 users whose profile "has NAICS", **7,928 (81.1%) carry the identical 5-code
-- placeholder default** (541512, 541611, 541330, 541990, 561210). Only 1,850 (17.3% of
-- all 10,700 users) ever selected anything.
--
-- So `naics_codes IS NOT NULL` has been read as "this user personalized their profile"
-- when four times in five it means the opposite. That is FALSE COMPLETENESS: the column
-- looks populated, so nothing flags it, and matching/analytics cannot tell a real choice
-- from a system fallback.
--
-- ⚠️ Deliberately a REAL COLUMN, not a JSON blob. Provenance is a first-class property of
-- the data — burying it in JSON is how it stops being queryable and starts being ignored.
--
-- Values:
--   user_confirmed      the user actively chose or confirmed these codes
--   derived_suggestion  Mindy derived them (suggest-codes / semantic keywords) and the
--                       user has not yet confirmed
--   system_default      a placeholder written because we had nothing — NEVER a signal of
--                       user intent
--   NULL                unknown provenance (historical rows we cannot establish)
--
-- ⚠️ NULL IS A REAL ANSWER. Ambiguous historical rows stay NULL rather than being guessed
-- into a bucket — inventing provenance would recreate the exact false-completeness problem
-- this column exists to end.

ALTER TABLE user_notification_settings
  ADD COLUMN IF NOT EXISTS naics_source text
    CHECK (naics_source IN ('user_confirmed', 'derived_suggestion', 'system_default'));

COMMENT ON COLUMN user_notification_settings.naics_source IS
  'How naics_codes came to be set: user_confirmed | derived_suggestion | system_default. '
  'NULL = provenance unknown (historical row). Never infer a value — 81% of legacy rows '
  'carry the 5-code placeholder default and must not read as user intent.';

-- Queries will ask "who actually chose their codes?" — index the discriminator.
CREATE INDEX IF NOT EXISTS idx_uns_naics_source
  ON user_notification_settings (naics_source);
