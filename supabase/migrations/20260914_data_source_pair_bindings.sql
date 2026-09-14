-- ═══════════════════════════════════════════════════════════════════════════
-- PAIR BINDINGS — the missing link between PHYSICAL storage and CANONICAL source.
--
-- WHY THIS EXISTS. Forecast health enumerates PHYSICAL (source_agency, source_type)
-- pairs — 30 of them — because starting from any registry hides whatever the registry
-- forgot. But `data_source_instances` is CANONICAL-SOURCE granular, and the two are
-- not 1:1:
--
--     ONE GSA Acquisition Gateway source  →  SEVEN physical pairs
--     ONE USACE manual source             →  THREE physical pairs
--     NASA/excel (superseded)             →  governed, but adds NO source
--     ONR + NRL (historical only)         →  controlled, with NO current source
--
-- Without an explicit relation, health can only ask "does this agency have an
-- instance?", which reports 13 agencies and 20,341 rows as UNREGISTERED even once
-- their architecture is fully understood — and would tempt someone to invent fake
-- per-agency instances just to make a number go green.
--
-- ⚠️ STRICTLY SUBORDINATE. No clocks, fingerprints, populations, owner, schedule,
-- currentness or alert state live here. Those stay authoritative on
-- `data_source_instances`; duplicating them is how two sources of truth drift apart.
-- This table answers exactly three questions:
--     What physical pair is this?
--     What is its final disposition?
--     Which canonical source instance governs it?
--
-- ⚠️ NO `canonical_source_key` COLUMN. Storing the readable key beside the FK lets the
-- two disagree. `data_source_instance_id` is authoritative; read the key through a
-- JOIN. NULL means there is genuinely no current canonical source (ONR, NRL), which
-- is a legitimate controlled state — not a gap to paper over.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS data_source_pair_bindings (
  id                      BIGSERIAL PRIMARY KEY,

  -- Subordinate to the same dataset catalogue the instances hang from.
  dataset_key             TEXT NOT NULL REFERENCES data_sources(key),

  -- The PHYSICAL path, exactly as stored in the data table.
  source_agency           TEXT NOT NULL,
  source_type             TEXT NOT NULL,

  -- The final Phase II disposition of this physical pair.
  --   canonical_active      — current, automated, governed
  --   canonical_controlled  — current, human-controlled/blocked-but-governed
  --   duplicate_ingest_path — the SAME procurements as a canonical pair, stored twice
  --   superseded            — replaced by a newer path; rows intentionally retained
  --   historical_only       — no current source; rows intentionally retained
  --   retired               — deliberately ended
  --   blocked               — upstream inaccessible
  pair_disposition        TEXT NOT NULL CHECK (pair_disposition IN (
                            'canonical_active','canonical_controlled','duplicate_ingest_path',
                            'superseded','historical_only','retired','blocked')),

  -- NULL ONLY when no current canonical source exists (historical_only / retired).
  -- RESTRICT: a governed pair must never be silently orphaned by an instance delete.
  data_source_instance_id BIGINT REFERENCES data_source_instances(id) ON DELETE RESTRICT,

  evidence                TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One disposition per physical pair. This is what makes "30/30 dispositioned,
  -- none double-counted" a database guarantee rather than a report's claim.
  UNIQUE (dataset_key, source_agency, source_type)
);

-- A pair that CLAIMS a current/governed disposition must name its governing instance.
-- historical_only and retired are the only states allowed to stand alone.
ALTER TABLE data_source_pair_bindings
  DROP CONSTRAINT IF EXISTS dspb_governed_requires_instance;
ALTER TABLE data_source_pair_bindings
  ADD CONSTRAINT dspb_governed_requires_instance CHECK (
    data_source_instance_id IS NOT NULL
    OR pair_disposition IN ('historical_only','retired')
  );

-- Readers: health lists by dataset and groups by governing instance. 30 rows — do
-- not over-index a control table.
CREATE INDEX IF NOT EXISTS idx_dspb_dataset  ON data_source_pair_bindings (dataset_key);
CREATE INDEX IF NOT EXISTS idx_dspb_instance ON data_source_pair_bindings (data_source_instance_id);

ALTER TABLE data_source_pair_bindings ENABLE ROW LEVEL SECURITY;
