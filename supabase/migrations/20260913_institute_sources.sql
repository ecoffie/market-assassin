-- THE MINDY INSTITUTE — canonical government research corpus.
--
-- OWNERSHIP MODEL (Eric, 2026-09-13):
--     GOVERNMENT SOURCE
--       -> MINDY INSTITUTE RESEARCH CORPUS   (this table — canonical, owns provenance)
--       -> STRATEGIC INTELLIGENCE DERIVATION (consumes it)
--       -> pain point / priority / funding / policy / buying signal
--
-- The Institute owns the EVIDENCE. Strategic Intelligence turns evidence into
-- foresight. A document is valuable Institute evidence **even when it produces no
-- derived intelligence at all** — so this table is NOT a pain-point staging area and
-- must never be optimized solely for that one pipeline.
--
-- WHAT ALREADY EXISTS AND IS *NOT* THIS (checked before building):
--   • research-publications.ts  RES-### = MINDY'S OWN publications (white papers).
--   • observatory-methodology.ts OBS-### = MINDY'S OWN metrics + methodology.
--   • /institute/evidence       a hand-curated case file in a hardcoded TS array.
--   • mindy_rag_documents       keyed on `source_path` = local teaching files on disk.
--   • agency_intelligence       agency-keyed (UNIQUE agency_name,type,title) so it
--                               CANNOT hold document identity — the same report appears
--                               under N agencies. That is the contamination Potato 0 fixed.
-- None of them can accept an ingested government document keyed by its own id.
-- The Institute has no DB at all today; every surface is static TypeScript.
--
-- Future Institute sources (schema supports, not implemented here): IG, CRS, enacted
-- and introduced legislation, appropriations, NDAA provisions, Federal Register, agency
-- budget justifications, strategic plans, procurement forecasts, executive directives.

CREATE TABLE IF NOT EXISTS institute_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── identity ───────────────────────────────────────────────────────────
  source_org        TEXT NOT NULL,          -- issuing body: 'GAO', 'OIG', 'CRS', 'Congress', ...
  source_type       TEXT NOT NULL CHECK (source_type IN (
                      'gao_report','ig_report','crs_report','enacted_law','introduced_bill',
                      'appropriation','ndaa_provision','federal_register','budget_justification',
                      'strategic_plan','procurement_forecast','executive_directive')),
  document_number   TEXT NOT NULL,          -- the body's OWN id: 'GAO-26-108092', 'PL 118-31'
  title             TEXT NOT NULL,
  source_url        TEXT NOT NULL,          -- NOT NULL BY DESIGN. 0 of 3,045 legacy pain points
                                            -- carry a URL; an uncitable Institute record must be
                                            -- structurally impossible.

  -- ── two different clocks, never conflated ──────────────────────────────
  publication_date  DATE,                   -- when the GOVERNMENT published it
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the INSTITUTE acquired it

  -- ── agency attribution, with its own receipt ───────────────────────────
  -- Resolved ONLY through src/lib/strategic-intel/agency-resolver.ts. NULL means
  -- unresolved and it STAYS unresolved — never a junk bucket, never a guess.
  canonical_agency  TEXT,
  toptier_code      TEXT,
  sub_agency        TEXT,                   -- only when defensible
  resolution_method TEXT,                   -- cgac_code|exact_name|alias|department_of|unresolved
  resolution_confidence TEXT,               -- high|medium|unresolved

  -- ── provenance + currentness ───────────────────────────────────────────
  source_watermark  TEXT,                   -- the feed position/date this was observed at
  abstract          TEXT,                   -- the body's own summary; what we reasoned over
  raw               JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- IDEMPOTENCY IS MECHANICAL: re-ingesting the same document cannot duplicate it.
  UNIQUE (source_type, document_number)
);

CREATE INDEX IF NOT EXISTS idx_institute_sources_agency
  ON institute_sources (canonical_agency, publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_institute_sources_published
  ON institute_sources (publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_institute_sources_org
  ON institute_sources (source_org, source_type);

-- ── INTELLIGENCE CHANGE LOG — append-only, references Institute evidence ──
-- Shape cloned from recompete_changes: TEXT old/new (one log for every value shape)
-- and a UNIQUE event key so a re-run cannot double-log.
-- ⚠️ A change not recorded WHILE IT HAPPENS is gone permanently and cannot be
-- backfilled at any price. This table exists BEFORE the collector for that reason.
CREATE TABLE IF NOT EXISTS intelligence_changes (
  id               BIGSERIAL PRIMARY KEY,

  domain           TEXT NOT NULL CHECK (domain IN
                     ('pain_point','priority','funding','policy','forecast','event')),
  canonical_agency TEXT NOT NULL,
  entity_key       TEXT NOT NULL,           -- the claim's stable identity

  change_type      TEXT NOT NULL CHECK (change_type IN
                     ('created','updated','strengthened','weakened','resolved')),
  old_value        TEXT,                    -- NULL on 'created'
  new_value        TEXT,

  -- the Institute evidence that triggered it. ONE stable id links the two systems
  -- instead of duplicating provenance into a second store.
  institute_source_id UUID REFERENCES institute_sources(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_changes_agency
  ON intelligence_changes (canonical_agency, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_changes_entity
  ON intelligence_changes (entity_key, changed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_changes_event
  ON intelligence_changes (entity_key, change_type, changed_at);

-- ── SMALLEST DELTA to the EXISTING derived store ─────────────────────────
-- agency_pain_points_db (20260405) already has agency, pain_point, category,
-- source CHECK(... 'gao' ...), source_url, naics_codes[], urgency, verified and
-- UNIQUE(agency, pain_point). It lacks only lifecycle + a link back to the Institute.
ALTER TABLE agency_pain_points_db
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IN ('emerging','active','strengthening','weakening','resolved')),
  ADD COLUMN IF NOT EXISTS confidence TEXT
    CHECK (confidence IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS institute_source_ids UUID[],
  ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_evidence_at TIMESTAMPTZ;

ALTER TABLE institute_sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_changes  ENABLE ROW LEVEL SECURITY;
