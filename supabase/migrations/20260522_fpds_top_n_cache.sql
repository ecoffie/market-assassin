-- FPDS-style top-N leaderboards cache
--
-- Caches the 4 USASpending category aggregations a BD person used
-- to get from the FPDS-NG sidebar:
--   - Top 10 Departments        (awarding_agency)
--   - Top 10 Contracting Agencies (awarding_subagency)
--   - Top 10 Vendors            (recipient)
--   - Top 10 Funding Agencies   (funding_agency, replaces Treasury Acct Symbol)
--
-- All 4 share the same query inputs (NAICS, state, fiscal year window,
-- excludeDOD) so we cache them together as a single JSONB blob keyed
-- on the query shape. One row per (naics, state, fy, excludeDOD)
-- combination.
--
-- TTL: 24 hours. USASpending data only refreshes weekly anyway, so
-- 24h is the right balance between staleness + USASpending rate
-- limits (1 req/sec, hard to scale across simultaneous users).

CREATE TABLE IF NOT EXISTS fpds_top_n_cache (
  -- Query identity. NULL means "any" — e.g. state=NULL queries all
  -- states; excludeDOD=false means DOD is included.
  naics_code TEXT NOT NULL,
  state_code TEXT NOT NULL DEFAULT '',  -- '' for nationwide
  fiscal_year INT NOT NULL,             -- e.g. 2024, 2025
  exclude_dod BOOLEAN NOT NULL DEFAULT FALSE,

  -- The 4 top-10 lists, each: [{ name, amount, count, rank }]
  -- Stored as JSONB so we can evolve the shape without migration.
  -- Example top_departments:
  --   [{"name": "Department of Defense", "amount": 4200000000, "count": 1840, "rank": 1}, ...]
  top_departments       JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_contracting       JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_vendors           JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_funding_agencies  JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Total market signals for context
  total_obligation NUMERIC,             -- sum across all departments in the period
  total_award_count INT,

  -- Observability
  source_endpoint TEXT DEFAULT 'usaspending_v2',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (naics_code, state_code, fiscal_year, exclude_dod)
);

-- Lookup pattern: get the most-recent cache rows for a NAICS across
-- recent fiscal years, since the UI may render trend across FYs.
CREATE INDEX IF NOT EXISTS idx_fpds_top_n_naics_fy
  ON fpds_top_n_cache (naics_code, fiscal_year DESC);

COMMENT ON TABLE fpds_top_n_cache IS
  'Per-(naics, state, fy, excludeDOD) cache of USASpending top-10 category aggregations (departments / contracting agencies / vendors / funding agencies). Mirrors what FPDS-NG used to show in the search sidebar.';

NOTIFY pgrst, 'reload schema';
