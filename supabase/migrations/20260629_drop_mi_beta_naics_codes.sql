-- ---------------------------------------------------------------------
-- Retire the legacy column mi_beta_user_settings.naics_codes
-- ---------------------------------------------------------------------
-- The canonical targeting NAICS now lives in user_notification_settings.
-- mi_beta_user_settings.naics_codes is no longer WRITTEN by any feature path
-- and no longer READ by the app (both Settings panels read from
-- user_notification_settings). The only remaining references — an admin
-- "scrub invalid NAICS" UPDATE and a CREATE-TABLE recreate line — were removed
-- in the same change that adds this migration.
--
-- Audit (2026-06-29): 80 rows in mi_beta_user_settings; 18 had a non-empty
-- naics_codes array, and 17 of those users already have the same/richer NAICS
-- in user_notification_settings. ONE user (biznlync@gmail.com) had 21 codes
-- only in this column with an empty canonical row — Step 1 preserves them so the
-- DROP loses no real user data.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------
-- 1) DATA PRESERVATION (run BEFORE the drop).
--    Copy legacy naics into the canonical table ONLY where the canonical row
--    exists but has no NAICS yet — i.e. an un-migrated stub. Never overwrites a
--    canonical row that already has codes (so a user's current targeting wins).
--    If you'd rather NOT restore these orphaned codes, delete this statement.
-- ---------------------------------------------------------------------
UPDATE user_notification_settings AS uns
SET naics_codes = mbs.naics_codes,
    updated_at  = NOW()
FROM mi_beta_user_settings AS mbs
WHERE uns.user_email = mbs.user_email
  AND mbs.naics_codes IS NOT NULL
  AND array_length(mbs.naics_codes, 1) > 0
  AND (uns.naics_codes IS NULL OR array_length(uns.naics_codes, 1) IS NULL);

-- ---------------------------------------------------------------------
-- 2) DROP the dead column.
-- ---------------------------------------------------------------------
ALTER TABLE mi_beta_user_settings DROP COLUMN IF EXISTS naics_codes;
