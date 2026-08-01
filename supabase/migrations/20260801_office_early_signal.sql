-- Per-office EARLY-SIGNAL score: does this buying office telegraph work before
-- it hits the street, or does it only post ready-to-bid solicitations?
--
-- WHY (measured 2026-08-01 against 32,467 active opportunities):
-- The department-level average is useless because it is made of opposites.
-- Across 1,022 offices with >=3 active opportunities:
--
--     404 offices post ZERO early notices
--     145 offices are >=50% early
--      50 offices are >=75% early
--     avg 21.2%   <- describes almost nobody
--
--   NAVAL AIR SYSTEMS COMMAND (N00019)   75% early
--   NAVAL AIR WARFARE CENTER  (N68936)   69% early
--   DLA AVIATION              (SPE4A7)   10% early
--
-- The behavioural read is the product: a HIGH score means the requirement can
-- still be shaped — go build the relationship. A LOW score means there is
-- nothing to influence; just bid it when it posts.
--
-- "Early" = Sources Sought + Presolicitation, the notice types posted BEFORE a
-- solicitation. Exact string match — sam_opportunities.notice_type is a closed
-- 9-value vocabulary, so no ILIKE guessing.
--
-- DENOMINATOR IS BIDDABLE NOTICES ONLY. Award Notice (5,867 active) and
-- Justification (586) are not opportunities; counting them understates every
-- office. Excluding them moves the average 19.0% -> 21.2% and lifts the
-- high-signal count from 47 to 56.
--
-- BANDS, NOT A BARE PERCENTAGE. Splitting the data at 2026-06-01, the mean
-- absolute swing per office between the two periods is 10.7 points and 438 of
-- 600 offices stay within 15 points. Showing "62%" would imply a precision the
-- data does not have; a band survives that noise. (Caveat: sam_opportunities
-- only holds data from 2026-03-15, so this is a within-window check, NOT a
-- year-over-year one.)
--
-- Additive and reversible; all columns nullable, so the ALTER is a metadata-only
-- catalog update with no table rewrite.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.dodaac_directory_display;   -- recreate w/o the new cols
--   ALTER TABLE public.dodaac_directory
--     DROP COLUMN IF EXISTS early_signal_pct,
--     DROP COLUMN IF EXISTS early_signal_band,
--     DROP COLUMN IF EXISTS early_signal_sample,
--     DROP COLUMN IF EXISTS early_signal_updated_at;

ALTER TABLE public.dodaac_directory
  ADD COLUMN IF NOT EXISTS early_signal_pct smallint,
  ADD COLUMN IF NOT EXISTS early_signal_band text,
  ADD COLUMN IF NOT EXISTS early_signal_sample smallint,
  ADD COLUMN IF NOT EXISTS early_signal_updated_at timestamptz;

-- Guard the band vocabulary at the DB level so a bad writer can't invent values
-- the UI has no rendering for.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dodaac_directory_early_signal_band_chk'
  ) THEN
    ALTER TABLE public.dodaac_directory
      ADD CONSTRAINT dodaac_directory_early_signal_band_chk
      CHECK (early_signal_band IS NULL OR early_signal_band IN ('high', 'medium', 'low', 'none'));
  END IF;
END $$;

COMMENT ON COLUMN public.dodaac_directory.early_signal_pct IS
  'Percent of this office''s BIDDABLE active notices that are Sources Sought or '
  'Presolicitation. Denominator excludes Award Notice / Justification / Sale of '
  'Surplus Property. NULL when the sample is too small to score.';

COMMENT ON COLUMN public.dodaac_directory.early_signal_band IS
  'Bucketed early_signal_pct: high >=50, medium 20-49, low 1-19, none = 0. '
  'Prefer the BAND over the raw percent in UI - per-office rates move ~10.7 '
  'points between periods, so a precise number implies false accuracy.';

COMMENT ON COLUMN public.dodaac_directory.early_signal_sample IS
  'Biddable active notices the score was computed from. A badge requires a '
  'floor (>=8); below that a 1-of-1 office reads as "100% early" and is noise.';

COMMENT ON COLUMN public.dodaac_directory.early_signal_updated_at IS
  'When the score was last recomputed. NULL = never scored.';

-- Partial index: the map filters on "show me offices that telegraph work",
-- which only ever touches scored rows.
CREATE INDEX IF NOT EXISTS dodaac_directory_early_signal_band_idx
  ON public.dodaac_directory (early_signal_band)
  WHERE early_signal_band IS NOT NULL;

-- Extend the display view (CREATE OR REPLACE keeps existing readers working —
-- columns are only ADDED, and the existing ones keep their position/name).
CREATE OR REPLACE VIEW public.dodaac_directory_display AS
  SELECT
    dodaac,
    COALESCE(NULLIF(TRIM(sam_office_name), ''), office_name) AS display_name,
    office_name      AS fpds_office_name,
    sam_office_name,
    (sam_office_name IS NOT NULL
     AND office_name IS NOT NULL
     AND UPPER(TRIM(sam_office_name)) <> UPPER(TRIM(office_name))) AS sources_disagree,
    agency,
    sub_agency,
    award_count,
    total_obligated,
    source,
    updated_at,
    sam_office_name_updated_at,
    early_signal_pct,
    early_signal_band,
    early_signal_sample,
    early_signal_updated_at,
    -- The single flag the UI should gate the badge on: scored, and scored from
    -- enough notices to mean something.
    (early_signal_band IS NOT NULL AND COALESCE(early_signal_sample, 0) >= 8) AS early_signal_shown
  FROM public.dodaac_directory;

COMMENT ON VIEW public.dodaac_directory_display IS
  'dodaac_directory with the display rule applied: display_name prefers the '
  'CURRENT SAM office name and falls back to the historical FPDS name. Also '
  'carries the early-signal score; gate any badge on early_signal_shown, which '
  'already enforces the small-sample floor. Use this for anything user-facing.';
