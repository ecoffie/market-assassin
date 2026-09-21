-- Profile Vault — Mindy's persistent user knowledge base
--
-- The strategic moat: easy to start, hard to leave. Every item a user
-- adds here makes Mindy's AI outputs personalized to THEIR business,
-- and accumulates value over months. Leaving Mindy means rebuilding
-- this entire library elsewhere.
--
-- Per Eric 2026-05-26: 'have them store their own information so we
-- can make the cost of switching away a high barrier. We want them
-- to be dependent on us.'
--
-- Five tables, one per category. Hybrid schema choice locked in
-- design phase: structured columns where shape is known, jsonb only
-- for parsed-sections payloads where shape may evolve.
--
-- Cross-app consumption: every AI prompt in Mindy (proposal/draft,
-- capability statement, daily briefings, content reaper) reads from
-- the user's vault first and falls back to defaults only when items
-- are missing. Vault content goes directly into prompts as 'use the
-- bidder's saved [past performance|capabilities|bio]'.

-- ---------------------------------------------------------------------
-- 1) user_identity_profile — UEI/CAGE/certs/etc.
-- ---------------------------------------------------------------------
-- One row per user_email. Existing user_business_profiles overlaps
-- partially; this is the AUTHORITATIVE store going forward. Future
-- migration may consolidate, but today we keep them separate to
-- avoid breaking the existing settings flow.

CREATE TABLE IF NOT EXISTS user_identity_profile (
  user_email TEXT PRIMARY KEY,

  -- Identifiers
  uei TEXT,                          -- SAM Unique Entity ID (12-char)
  cage_code TEXT,                    -- CAGE Code (5-char)
  duns TEXT,                         -- legacy DUNS for older systems
  ein TEXT,                          -- IRS EIN (for payment forms)

  -- Business profile
  legal_name TEXT,                   -- e.g. 'Acme Federal Services LLC'
  dba TEXT,                          -- doing-business-as if different
  year_founded INT,
  employee_count INT,
  annual_revenue NUMERIC,

  -- Certifications & business type (array of strings, e.g.
  -- ['Small Business', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone'])
  certifications TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Primary NAICS codes — the codes they actually want to bid on,
  -- in their preferred order. Authoritative when vault is populated;
  -- alerts/briefings system reads this first, falls back to
  -- user_notification_settings.naics_codes.
  primary_naics TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Service / capability summary in their own words. Goes into
  -- every cap-statement Company Overview draft.
  one_liner TEXT,                    -- e.g. 'AI-powered cybersecurity for federal'
  elevator_pitch TEXT,               -- 2-3 sentence longer version

  -- Geography
  hq_state TEXT,
  hq_city TEXT,
  service_states TEXT[] DEFAULT ARRAY[]::TEXT[],   -- states they can perform in

  -- Contract vehicles held (GSA Schedule, OASIS, CIO-SP3, etc.)
  contract_vehicles TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_identity_profile IS
  'Vault layer 1: authoritative business identity. Every AI prompt that mentions company facts (cap statement, proposal draft, content reaper) reads from here.';

-- ---------------------------------------------------------------------
-- 2) user_past_performance — real contracts they''ve done
-- ---------------------------------------------------------------------
-- The single highest-value table for proposal lock-in. Once 5+ rows
-- exist, every cap statement / proposal draft cites real work instead
-- of bracketed [placeholders].

CREATE TABLE IF NOT EXISTS user_past_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Contract identification
  contract_title TEXT NOT NULL,
  contract_number TEXT,              -- e.g. 'W912PL19C0015'
  agency TEXT NOT NULL,              -- e.g. 'Department of the Navy'
  sub_agency TEXT,
  office TEXT,                       -- specific contracting office

  -- Timeline + value
  period_start DATE,
  period_end DATE,
  contract_value NUMERIC,            -- total contract value
  user_share_value NUMERIC,          -- if sub, their portion

  -- Role & scope
  role TEXT,                         -- 'prime' | 'sub' | 'jv_partner'
  scope_description TEXT,            -- 2-4 sentences of what they did

  -- Performance evidence
  outcomes TEXT,                     -- measurable results
  cpars_rating TEXT,                 -- e.g. 'Exceptional', 'Very Good'

  -- References (for past-perf citations)
  reference_name TEXT,
  reference_title TEXT,
  reference_email TEXT,
  reference_phone TEXT,

  -- Discoverability for AI matching — when drafting against an RFP,
  -- we match on overlap with these tags
  relevance_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  naics_codes TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Provenance — was this hand-entered or AI-extracted from a doc?
  source TEXT DEFAULT 'manual',      -- 'manual' | 'parsed_cap_stmt' | 'bulk_upload'
  source_doc_id UUID,                -- FK to user_boilerplate_docs if AI-extracted

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ            -- soft delete; query filters WHERE archived_at IS NULL
);

CREATE INDEX IF NOT EXISTS idx_past_perf_user ON user_past_performance(user_email, archived_at);
CREATE INDEX IF NOT EXISTS idx_past_perf_agency ON user_past_performance(agency);
CREATE INDEX IF NOT EXISTS idx_past_perf_keywords ON user_past_performance USING GIN (relevance_keywords);

COMMENT ON TABLE user_past_performance IS
  'Vault layer 2: real contracts the bidder has won. AI past-performance drafts cite from here instead of using [placeholders]. Highest moat-per-row of any vault table.';

-- ---------------------------------------------------------------------
-- 3) user_capabilities_library — what they can DO
-- ---------------------------------------------------------------------
-- Plain-English capability blurbs tagged with NAICS. When an RFP
-- requirement mentions 'cybersecurity' and the user has 3 capability
-- entries tagged with cyber-related NAICS, the AI weaves those in.

CREATE TABLE IF NOT EXISTS user_capabilities_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  capability_name TEXT NOT NULL,     -- short label e.g. 'Penetration Testing'
  description TEXT NOT NULL,         -- 1-3 sentences in their voice

  -- Discoverability
  related_naics TEXT[] DEFAULT ARRAY[]::TEXT[],
  related_psc TEXT[] DEFAULT ARRAY[]::TEXT[],
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Evidence (e.g. 'OSCP certified team', 'NIST 800-53 implementation experience')
  evidence TEXT,

  -- Tools / methodologies / standards they apply
  tools_methods TEXT[] DEFAULT ARRAY[]::TEXT[],   -- ['Burp Suite', 'Metasploit', 'OWASP']

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_capabilities_user ON user_capabilities_library(user_email, archived_at);
CREATE INDEX IF NOT EXISTS idx_capabilities_keywords ON user_capabilities_library USING GIN (keywords);
CREATE INDEX IF NOT EXISTS idx_capabilities_naics ON user_capabilities_library USING GIN (related_naics);

COMMENT ON TABLE user_capabilities_library IS
  'Vault layer 3: tagged capability blurbs in the bidders own voice. AI Capabilities sections of cap statements / proposals pull from here.';

-- ---------------------------------------------------------------------
-- 4) user_team_members — key personnel
-- ---------------------------------------------------------------------
-- Powers Management Plan / Key Personnel sections + Team Bios for
-- capability statements. Resume PDFs stored in Supabase Storage
-- (bucket: vault-assets) for full text reference.

CREATE TABLE IF NOT EXISTS user_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Identity
  full_name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,

  -- Qualifications
  years_experience INT,
  certifications TEXT[] DEFAULT ARRAY[]::TEXT[],   -- ['PMP', 'CISSP', 'Top Secret']
  security_clearance TEXT,                          -- 'Public Trust' | 'Secret' | 'Top Secret' | 'TS/SCI'

  -- Bio content
  bio_short TEXT,                    -- 1-2 sentence intro
  bio_full TEXT,                     -- full paragraph for proposal sections

  -- Resume document (full text + original file)
  resume_storage_path TEXT,
  resume_extracted_text TEXT,        -- searchable

  -- Role on team (defines which sections cite them)
  role_type TEXT,                    -- 'program_manager' | 'technical_lead' | 'capture' | 'subject_matter_expert' | 'executive' | 'other'

  is_key_personnel BOOLEAN DEFAULT false,   -- show in proposal Key Personnel sections

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON user_team_members(user_email, archived_at);
CREATE INDEX IF NOT EXISTS idx_team_members_key ON user_team_members(user_email) WHERE is_key_personnel = true;

COMMENT ON TABLE user_team_members IS
  'Vault layer 4: key personnel + bios. Powers Management Plan / Key Personnel proposal sections, Capability Statement team blurbs, and any Mindy output that names team members.';

-- ---------------------------------------------------------------------
-- 5) user_boilerplate_docs — uploaded existing assets
-- ---------------------------------------------------------------------
-- The 'upload your current capability statement' entry point. AI
-- parses on upload + stores both original blob (Supabase Storage)
-- and parsed sections (jsonb) so the user can edit + use either.

CREATE TABLE IF NOT EXISTS user_boilerplate_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- What kind of doc this is
  doc_type TEXT NOT NULL,            -- 'cap_stmt' | 'company_overview' | 'cover_letter' | 'past_perf_table' | 'pricing_template' | 'other'

  -- Original file (kept so user can re-download / re-parse)
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,                 -- in Supabase Storage bucket 'vault-assets'

  -- Extracted content
  extracted_text TEXT,               -- full text (up to 200K chars)
  page_count INT,

  -- AI-parsed structured form (varies by doc_type — e.g. cap_stmt
  -- has { company_overview, capabilities, past_performance[],
  -- differentiators, poc } shape). User can edit this and save.
  parsed_sections JSONB,

  -- Confidence/quality signals
  parse_status TEXT DEFAULT 'pending',  -- 'pending' | 'parsed' | 'failed' | 'edited'
  parse_error TEXT,

  -- Did the user confirm + extract rows into other vault tables?
  -- e.g. 'yes — created 3 past_performance rows from this cap stmt'
  extracted_to_vault_at TIMESTAMPTZ,
  extracted_row_counts JSONB,        -- { past_performance: 3, capabilities: 5 }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_boilerplate_user ON user_boilerplate_docs(user_email, archived_at);
CREATE INDEX IF NOT EXISTS idx_boilerplate_type ON user_boilerplate_docs(user_email, doc_type, archived_at);

COMMENT ON TABLE user_boilerplate_docs IS
  'Vault layer 5: uploaded existing assets (capability statements, company overviews, etc.). AI parses on upload into structured form (parsed_sections jsonb) which user can edit; both original blob + parsed structure stored.';

-- ---------------------------------------------------------------------
-- Schema reload signal
-- ---------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
