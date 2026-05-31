-- PSC as a first-class filter — Slice 5b item #1 of the Target Market
-- Research roadmap (tasks/target-market-research-roadmap.md).
--
-- The Market Research agency table can be searched by PSC, but the
-- cache key was (naics, business_type, veteran_status) — so two
-- searches with the same NAICS but different PSC collided and served
-- each other's stale rows. PSC must be part of the cache key.
--
-- Eric, May 22: "PSC codes are closer indicator of precise business
-- offering versus NAICS... We need to allow for PSC code to do all the
-- above in Target Market Research." NAICS 541512 = 50,000-company
-- bucket; PSC D316 = ~500 companies. BD precision lives at PSC.
--
-- Existing rows keep their effective key: psc_code defaults to '',
-- which is exactly what they were implicitly keyed on before. No data
-- loss, no collisions on migrate.

-- 1) New column (defaults '' so existing rows are valid PK members).
ALTER TABLE agency_target_data_cache
  ADD COLUMN IF NOT EXISTS psc_code TEXT DEFAULT '';

-- 2) Repoint the primary key to include psc_code. Drop the old PK by
--    its conventional name, then re-add with psc_code in the tuple.
--    Guarded so re-runs don't error if the new PK already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agency_target_data_cache_pkey'
  ) THEN
    ALTER TABLE agency_target_data_cache
      DROP CONSTRAINT agency_target_data_cache_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agency_target_data_cache'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE agency_target_data_cache
      ADD PRIMARY KEY (naics_code, psc_code, business_type, veteran_status);
  END IF;
END $$;

COMMENT ON TABLE agency_target_data_cache IS
  'Cache for /api/app/target-market-research merged response (USASpending + SAM + pain points + events). 24h TTL. Keyed by (naics, psc, business_type, veteran_status) as of 2026-05-31 — PSC added so NAICS+PSC and PSC-only searches cache distinctly.';

NOTIFY pgrst, 'reload schema';
