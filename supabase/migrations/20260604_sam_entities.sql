-- SAM.gov Entity Registry Cache (Government Buyer Market Research)
-- =================================================================
-- Stores SAM-registered contractor entities for fast local filtered
-- search — the reverse-search surface for government buyers
-- ("find businesses for this requirement").
--
-- Re-sources what OpenGov IQ's `SAMEntities` table held (access lost
-- 2026-06; do NOT depend on OpenGov). Populated by the existing daily
-- SAM cron via the Entity Management API (searchEntities), cached here
-- like sam_opportunities so there are no per-query rate limits.
--
-- PRD: docs/PRD-gov-buyer-market-research.md
-- Activity rubric (Active Performer Score) reads this LEFT-joined to
-- BigQuery `recipients` by UEI — registered-but-never-won firms survive
-- the join (no award row) and score into the Emerging / Registered-Only
-- tiers. They are NEVER filtered out (Eric's fairness rule).

CREATE TABLE IF NOT EXISTS sam_entities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identifiers (UEI is the universal join key to BQ recipients/awards
  -- and to user_identity_profile / user_boilerplate_docs for cap stmts)
  uei TEXT NOT NULL UNIQUE,
  cage_code TEXT,
  duns TEXT,                         -- legacy, some older rows still carry it

  -- Names
  legal_business_name TEXT NOT NULL,
  dba_name TEXT,

  -- Location (state is the primary buyer filter alongside NAICS)
  physical_city TEXT,
  physical_state TEXT,
  physical_zip TEXT,
  physical_country TEXT,

  -- Classification
  primary_naics TEXT,
  naics_codes TEXT[] DEFAULT '{}',   -- all registered NAICS
  psc_codes TEXT[] DEFAULT '{}',

  -- Set-aside / socioeconomic certifications.
  -- STRUCTURED array (not a free-text blob) so the buyer set-aside
  -- filter is a reliable array-contains, not a fragile ILIKE. Values
  -- are normalized labels: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB',
  -- 'Small Business'. (entity-api.ts SBA_TYPE_MAP produces these.)
  certifications TEXT[] DEFAULT '{}',

  -- Registration status — gates "active" for the determination.
  -- A CO reads our count as a defensibility claim, so we filter on
  -- Active + non-expired and surface registration_expiry in the memo.
  registration_status TEXT,          -- 'Active' / 'Inactive' / 'Expired'
  registration_expiry DATE,
  exclusion_flag BOOLEAN DEFAULT false,  -- debarred/excluded (never count these)

  -- Points of contact (entity-side, from SAM). NOT the 5 BD roles —
  -- those live in federal_contacts. Kept here for convenience.
  points_of_contact JSONB DEFAULT '[]'::jsonb,

  entity_url TEXT,                   -- company website
  sam_url TEXT,                      -- deep link back to the SAM record

  -- Cache bookkeeping
  raw_data JSONB DEFAULT '{}'::jsonb,
  source TEXT DEFAULT 'sam_entity_api',  -- provenance: how this row was synced
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes mirror the buyer query: NAICS + state + set-aside, plus UEI
-- joins and a name search.
CREATE INDEX IF NOT EXISTS idx_sam_entities_uei            ON sam_entities(uei);
CREATE INDEX IF NOT EXISTS idx_sam_entities_cage           ON sam_entities(cage_code);
CREATE INDEX IF NOT EXISTS idx_sam_entities_primary_naics  ON sam_entities(primary_naics);
CREATE INDEX IF NOT EXISTS idx_sam_entities_state          ON sam_entities(physical_state);
CREATE INDEX IF NOT EXISTS idx_sam_entities_status         ON sam_entities(registration_status);
CREATE INDEX IF NOT EXISTS idx_sam_entities_expiry         ON sam_entities(registration_expiry);

-- GIN indexes for the array-contains filters (NAICS-in-any + set-aside).
CREATE INDEX IF NOT EXISTS idx_sam_entities_naics_gin      ON sam_entities USING GIN (naics_codes);
CREATE INDEX IF NOT EXISTS idx_sam_entities_certs_gin      ON sam_entities USING GIN (certifications);

-- Full-text search on names for the directory.
CREATE INDEX IF NOT EXISTS idx_sam_entities_name_fts ON sam_entities
  USING GIN (to_tsvector('english',
    coalesce(legal_business_name, '') || ' ' || coalesce(dba_name, '')));

-- Resumable-sync checkpoint (mirrors sam_opportunities sync_state).
-- Tracks which (NAICS,state) seed slices have been pulled so the daily
-- cron extends coverage incrementally instead of re-pulling everything.
CREATE TABLE IF NOT EXISTS sam_entities_sync_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  naics_code TEXT NOT NULL,
  state_code TEXT,                   -- NULL = nationwide for that NAICS
  last_page INT DEFAULT 0,
  total_records INT,
  entities_upserted INT DEFAULT 0,
  status TEXT DEFAULT 'pending',     -- pending / in_progress / complete / error
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (naics_code, state_code)
);

CREATE INDEX IF NOT EXISTS idx_sam_entities_sync_status ON sam_entities_sync_state(status);

COMMENT ON TABLE sam_entities IS
  'SAM-registered entity cache for government-buyer reverse search. Synced from SAM Entity API via daily cron. See docs/PRD-gov-buyer-market-research.md';
COMMENT ON COLUMN sam_entities.certifications IS
  'Normalized set-aside labels (8(a)/HUBZone/SDVOSB/WOSB/EDWOSB/Small Business). Structured array for reliable set-aside filtering — NOT a free-text blob.';
