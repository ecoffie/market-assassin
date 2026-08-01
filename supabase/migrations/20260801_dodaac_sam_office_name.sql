-- dodaac_directory: separate the HISTORICAL office name from the CURRENT one.
--
-- WHY THIS COLUMN EXISTS (measured 2026-08-01, backfill applied same day):
-- 187 of 1,247 offices carry a DIFFERENT name in SAM than in FPDS, and both are
-- legitimate: FPDS is the historical award record, SAM's agency_hierarchy names
-- whoever is buying NOW. Overwriting either destroys information, so office_name
-- stays untouched and the current name gets its own column.
--
-- The wins are real. SAM replaces internal codes with the name a contractor
-- would recognise, and is untruncated where FPDS is fixed-width:
--   124443  FPDS: "USDA-FS, CSA EAST 5"  SAM: "MONONGAHELA NATIONAL FOREST"
--
-- CORRECTION, kept deliberately: an earlier version of this comment justified
-- the column with "W912QR = ENDIST LOUISVILLE in FPDS but ENDIST BALTIMORE in
-- SAM". That was WRONG — it came from a single max(agency_hierarchy) sample,
-- which is alphabetical rather than representative. The real vote is 88
-- Louisville to 1 Baltimore; W91238 is 29 Sacramento to 2 San Francisco;
-- W912EF is unanimous. FPDS and SAM AGREE on all three of those offices. The
-- column earns its place on the other 187, not on that example.
--
-- This is ADDITIVE and REVERSIBLE. Both columns are nullable, so the ALTER is a
-- metadata-only catalog update in Postgres 11+ — no table rewrite, no lock held
-- while 4,813 rows are copied. Existing readers that SELECT office_name are
-- unaffected; nothing is dropped or renamed.
--
-- Rollback:
--   ALTER TABLE public.dodaac_directory
--     DROP COLUMN IF EXISTS sam_office_name,
--     DROP COLUMN IF EXISTS sam_office_name_updated_at;

ALTER TABLE public.dodaac_directory
  ADD COLUMN IF NOT EXISTS sam_office_name text,
  ADD COLUMN IF NOT EXISTS sam_office_name_updated_at timestamptz;

COMMENT ON COLUMN public.dodaac_directory.office_name IS
  'HISTORICAL office name from FPDS awards. Fixed-width source, so long names '
  'are truncated ("US ARMY ENGINEER DISTRICT WALLA WAL"). Reflects the office '
  'as named across its award history, which may differ from who buys there now '
  '- see sam_office_name. Populated by refreshDodaacDirectory().';

COMMENT ON COLUMN public.dodaac_directory.sam_office_name IS
  'CURRENT office name, derived from the leaf of sam_opportunities.'
  'agency_hierarchy on ACTIVE solicitations. Untruncated. NULL when the office '
  'has no active SAM opportunity (~3,500 of 4,813 rows). Prefer this for '
  '"who is buying today"; prefer office_name for award-history context.';

COMMENT ON COLUMN public.dodaac_directory.sam_office_name_updated_at IS
  'When sam_office_name was last refreshed from SAM. NULL = never populated.';

-- Partial index: only ~1,249 rows are non-NULL, and every read filters on that.
CREATE INDEX IF NOT EXISTS dodaac_directory_sam_office_name_idx
  ON public.dodaac_directory (sam_office_name)
  WHERE sam_office_name IS NOT NULL;

-- The display rule, defined ONCE. Callers select display_name instead of
-- repeating COALESCE at every site (and drifting when one of them forgets).
--
-- Prefer the CURRENT buyer's name; fall back to the historical FPDS name when
-- the office has no active SAM solicitation (~3,564 of 4,813 rows).
--   1,249 rows resolve to the SAM name  (363 of them differ from FPDS)
--   3,564 rows fall back to FPDS
CREATE OR REPLACE VIEW public.dodaac_directory_display AS
  SELECT
    dodaac,
    COALESCE(NULLIF(TRIM(sam_office_name), ''), office_name) AS display_name,
    office_name      AS fpds_office_name,
    sam_office_name,
    -- TRUE only where the two sources genuinely disagree, so the UI can show
    -- the FPDS name as secondary context without checking both every time.
    (sam_office_name IS NOT NULL
     AND office_name IS NOT NULL
     AND UPPER(TRIM(sam_office_name)) <> UPPER(TRIM(office_name))) AS sources_disagree,
    agency,
    sub_agency,
    award_count,
    total_obligated,
    source,
    updated_at,
    sam_office_name_updated_at
  FROM public.dodaac_directory;

COMMENT ON VIEW public.dodaac_directory_display IS
  'dodaac_directory with the display rule applied: display_name prefers the '
  'CURRENT SAM office name and falls back to the historical FPDS name. Use '
  'this for anything user-facing; query the base table directly only when you '
  'specifically need one source or the other.';
