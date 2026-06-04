-- =====================================================================
-- GOVERNMENT BUYER MARKET RESEARCH — combined migration paste-block
-- =====================================================================
-- Run this whole block ONCE in the Supabase SQL Editor (this DB has no
-- in-app DDL — migrations are hand-run). Idempotent: every statement is
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so re-running is safe.
-- Expect: "Success. No rows returned."
--
-- Contains, in order:
--   1. sam_entities + sam_entities_sync_state   (SB registry + checkpoint)
--   2. federal_contacts                          (gov people search)
--   3. user_profiles.user_type                   (buyer access gate)
--
-- PRD: docs/PRD-gov-buyer-market-research.md
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. SAM-registered entity cache (the rubric's base list)
-- ─────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────
-- 2. Federal contacts — government-side people search (HigherGov-style)
-- ─────────────────────────────────────────────────────────────────────
-- IMPORTANT: this table ALREADY EXISTS in production (created ad-hoc by
-- import-sam-entity-pocs.js — no migration file ever captured it). So we
-- CREATE-IF-NOT-EXISTS the base shape AND then ADD COLUMN IF NOT EXISTS
-- every column. That way this block is correct whether the table is brand
-- new or a pre-existing partial schema (the original 42703 error was the
-- index referencing role_category on the pre-existing table before the
-- column was added).
--
-- COVERAGE (be honest): SAM points_of_contact reliably yields only the
-- CONTRACTING officer/specialist named on a notice. The other 4 BD roles
-- (decision maker, program manager, engineer/technical lead, end user)
-- are NOT in SAM POCs. The role_category column exists from day one so
-- adding those roles later is an INSERT, not a re-architecture.
CREATE TABLE IF NOT EXISTS federal_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_row_key TEXT NOT NULL UNIQUE
);

-- Backfill every column whether the table is new or pre-existing.
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS contact_fullname      TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS contact_title         TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS contact_email         TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS contact_phone         TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS department_ind_agency TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS office                TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS sub_tier              TEXT;
-- THE 5-role future-proofing. 'contracting' now; other buckets fill later.
-- ('contracting' | 'program' | 'technical' | 'end_user' | 'decision_maker')
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS role_category         TEXT DEFAULT 'contracting';
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS solicitation_number   TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS posted_date           TEXT;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS source                TEXT DEFAULT 'sam_opportunities_poc';
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS raw_data              JSONB DEFAULT '{}'::jsonb;
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS imported_at           TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE federal_contacts ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ DEFAULT NOW();

-- Backfill role_category on any pre-existing rows that predate the column
-- (NULL default would otherwise leave old import-sam-entity-pocs rows blank).
UPDATE federal_contacts SET role_category = 'contracting' WHERE role_category IS NULL;

CREATE INDEX IF NOT EXISTS idx_federal_contacts_agency ON federal_contacts(department_ind_agency);
CREATE INDEX IF NOT EXISTS idx_federal_contacts_email  ON federal_contacts(contact_email);
CREATE INDEX IF NOT EXISTS idx_federal_contacts_role   ON federal_contacts(role_category);
CREATE INDEX IF NOT EXISTS idx_federal_contacts_search ON federal_contacts
  USING GIN (to_tsvector('english',
    coalesce(contact_fullname, '') || ' ' ||
    coalesce(contact_title, '')   || ' ' ||
    coalesce(department_ind_agency, '') || ' ' ||
    coalesce(office, '')          || ' ' ||
    coalesce(sub_tier, '')));

COMMENT ON COLUMN federal_contacts.role_category IS
  'Which of the 5 BD roles this person is. Only "contracting" is populated today (from SAM POCs). program/technical/end_user/decision_maker await a future source — see docs/PRD-gov-buyer-market-research.md §7.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. Buyer access gate — user_profiles.user_type
-- ─────────────────────────────────────────────────────────────────────
-- 'seller' (default) vs 'gov_buyer'. Gates /api/gov-buyer/*. The two
-- pilot officials are hand-provisioned:
--   UPDATE user_profiles SET user_type='gov_buyer' WHERE email='...';
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'seller';
    -- 'seller' | 'gov_buyer'

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_type ON user_profiles(user_type);

COMMENT ON COLUMN user_profiles.user_type IS
  'seller (default) or gov_buyer. Gates the government-buyer market-research surface. See docs/PRD-gov-buyer-market-research.md §5.';


-- =====================================================================
-- VERIFY (optional) — run after the block to confirm everything landed.
-- Should return 3 table rows + the user_type column row.
-- =====================================================================
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('sam_entities','sam_entities_sync_state','federal_contacts');
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name='user_profiles' AND column_name='user_type';
