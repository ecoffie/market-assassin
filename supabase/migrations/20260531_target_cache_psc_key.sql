-- PSC as a first-class filter — Slice 5b item #1 of the Target Market
-- Research roadmap (tasks/target-market-research-roadmap.md).
--
-- The Market Research agency table can be searched by PSC, but the
-- cache key was (naics, business_type, veteran_status) — so two
-- searches with the same NAICS but different PSC would collide. PSC
-- must be part of the cache key.
--
-- Eric, May 22: "PSC codes are closer indicator of precise business
-- offering versus NAICS... allow PSC code to do all the above in Target
-- Market Research." NAICS 541512 = 50,000-company bucket; PSC D316 =
-- ~500 companies. BD precision lives at PSC.
--
-- NOTE: in production the base table (20260522_target_account_data_cache)
-- was never applied — the route fail-softs on a missing cache table, so
-- Market Research worked but never cached. This migration is therefore
-- SELF-CONTAINED: it creates the table WITH psc_code in the PK if it's
-- absent, and ALTERs psc_code into the key if an older version exists.
-- Idempotent either way.

-- 1) Create the table with psc_code already in the composite key.
CREATE TABLE IF NOT EXISTS agency_target_data_cache (
  naics_code TEXT NOT NULL,
  psc_code TEXT NOT NULL DEFAULT '',     -- Product/Service Code (Slice 5b)
  business_type TEXT DEFAULT '',         -- 'Women Owned' / '8(a) Certified' / etc
  veteran_status TEXT DEFAULT '',        -- 'SDVOSB' / 'VOSB' / 'Not Applicable'

  agencies JSONB NOT NULL,               -- TargetMarketResearchRow[]
  total_count INT NOT NULL DEFAULT 0,
  total_spending NUMERIC NOT NULL DEFAULT 0,
  sat_summary JSONB,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generation_ms INT,
  source_versions JSONB,

  PRIMARY KEY (naics_code, psc_code, business_type, veteran_status)
);

-- 2) If an OLDER version of the table already existed (without psc_code
--    in the key), bring it up to spec: add the column, then repoint the
--    primary key. No-ops cleanly when step 1 just created it fresh.
ALTER TABLE agency_target_data_cache
  ADD COLUMN IF NOT EXISTS psc_code TEXT NOT NULL DEFAULT '';

DO $$
DECLARE
  pk_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'agency_target_data_cache'::regclass AND c.contype = 'p';

  -- Only rebuild the PK if it doesn't already include psc_code.
  IF pk_cols IS NULL OR position('psc_code' in pk_cols) = 0 THEN
    IF pk_cols IS NOT NULL THEN
      ALTER TABLE agency_target_data_cache
        DROP CONSTRAINT agency_target_data_cache_pkey;
    END IF;
    ALTER TABLE agency_target_data_cache
      ADD PRIMARY KEY (naics_code, psc_code, business_type, veteran_status);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agency_target_data_generated_at
  ON agency_target_data_cache (generated_at);

COMMENT ON TABLE agency_target_data_cache IS
  'Cache for /api/app/target-market-research merged response (USASpending + SAM + pain points + events). 24h TTL. Keyed by (naics, psc, business_type, veteran_status) as of 2026-05-31 — PSC added so NAICS+PSC and PSC-only searches cache distinctly.';

NOTIFY pgrst, 'reload schema';
