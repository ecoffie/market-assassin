-- Federal Contacts — Government-Side People Search (HigherGov-style)
-- =================================================================
-- Names + contacts for government people, sourced from our OWN SAM
-- data (sam_opportunities.points_of_contact). Re-sources what OpenGov
-- IQ's `AllSamContacts` held (access lost 2026-06).
--
-- NOTE: scripts/populate-contracting-officers.js references this table
-- as "already provisioned by 20260512_federal_contacts.sql" but that
-- migration never existed. This file is the real provisioning.
--
-- PRD: docs/PRD-gov-buyer-market-research.md §7
--
-- COVERAGE (be honest): SAM points_of_contact reliably yields only the
-- CONTRACTING officer/specialist named on a notice — the LAST line of
-- defense, not the first. The other 4 BD roles (decision maker, program
-- manager, engineer/technical lead, end user) are NOT in SAM POCs.
-- The role_category column exists from day one so adding those roles
-- later is an INSERT, not a re-architecture. We ship 'contracting' now.

CREATE TABLE IF NOT EXISTS federal_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Dedup key: encodes source notice + contact index (idempotent re-runs).
  source_row_key TEXT NOT NULL UNIQUE,

  -- Person
  contact_fullname TEXT,
  contact_title TEXT,
  contact_email TEXT,
  contact_phone TEXT,

  -- Org placement
  department_ind_agency TEXT,
  office TEXT,
  sub_tier TEXT,

  -- THE 5-role future-proofing. Populated 'contracting' now; the other
  -- buckets stay empty until a source for them exists. The people search
  -- and buyer surface key off this column and don't care that only one
  -- bucket is full yet.
  role_category TEXT DEFAULT 'contracting',
    -- 'contracting' | 'program' | 'technical' | 'end_user' | 'decision_maker'

  -- Provenance
  solicitation_number TEXT,
  posted_date TEXT,
  source TEXT DEFAULT 'sam_opportunities_poc',
  raw_data JSONB DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
