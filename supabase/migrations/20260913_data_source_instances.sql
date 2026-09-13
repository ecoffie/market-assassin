-- MATERIAL UPSTREAM SOURCE STATE — the producer layer under the dataset catalogue.
--
-- THE SPLIT (Eric, 2026-09-13):
--     data_sources           LOGICAL DATASET catalogue  ('forecast_intelligence')
--     data_source_instances  MATERIAL UPSTREAM SOURCE   ('forecast_navy_lrae')
--
-- This is NOT a second registry: every instance is subordinate to a logical
-- dataset through the dataset_key foreign key. One dataset, many producers.
--
-- WHY A TABLE AND NOT A `notes` SENTINEL BLOCK
-- The two most recent sources (institute_gao, bq_awards) store their clocks as
-- machine-written JSON inside the prose `notes` column ([gao-ingest-clocks:v1],
-- [awards-ingest-clocks:v1]). That convention cannot be queried, indexed, or
-- constrained — and the proof that it rots is sitting in the same table:
-- forecast_intelligence.record_count still reads 7764, a hand-typed April figure,
-- beside notes pointing at forecast_sources as a health authority that was
-- abandoned. Structured state gets columns.
--
-- ⚠️ ALERT STATE DELIBERATELY LIVES ELSEWHERE. ops_alert_state already owns
-- fingerprints, reminder timing and suppression. This table describes DATA TRUTH;
-- that one describes NOTIFICATION STATE. Duplicating opened/resolved/fingerprint
-- here would create two authorities that silently disagree.
--
-- ⚠️ GAO AND AWARDS ARE NOT MIGRATED HERE. Their sentinel blocks stay untouched
-- until this model proves itself.

CREATE TABLE IF NOT EXISTS data_source_instances (
  id                    BIGSERIAL PRIMARY KEY,

  -- ── identity + subordination ───────────────────────────────────────────
  dataset_key           TEXT NOT NULL REFERENCES data_sources(key),
  source_key            TEXT UNIQUE NOT NULL,   -- 'forecast_navy_lrae'
  name                  TEXT NOT NULL,
  discovery_url         TEXT,

  -- ingest_mode is the ingest contract, NOT a health verdict.
  -- blocked != manual: `manual` means a human CAN do it and the steps are known;
  -- `blocked` means the procedure itself is unresolved. Collapsing them produces
  -- alerts that instruct an operator to do something impossible.
  ingest_mode           TEXT NOT NULL CHECK (ingest_mode IN ('automated','manual','blocked')),
  owner                 TEXT,                   -- accountable role/team; NULL is itself a finding
  watch_cadence_days    INTEGER CHECK (watch_cadence_days IS NULL OR watch_cadence_days > 0),

  -- ── THE FIVE CLOCKS, each a different fact ─────────────────────────────
  -- A successful poll is NOT data advancement. Conflating any two of these is how
  -- a frozen source reports healthy.
  last_poll             TIMESTAMPTZ,  -- we attempted to check upstream
  last_successful_check TIMESTAMPTZ,  -- we determined upstream's state
  last_source_advance   TIMESTAMPTZ,  -- UPSTREAM itself published something new.
                                      -- NULL when upstream advancement cannot be
                                      -- measured. NEVER synthesized from our ingest
                                      -- time — that would make our own activity look
                                      -- like government activity.
  last_verified_ingest  TIMESTAMPTZ,  -- we took data in and proved it landed
  last_data_advance     TIMESTAMPTZ,  -- the data Mindy HOLDS actually changed

  -- ── upstream vs held, never merged into one "version" ──────────────────
  latest_upstream_revision TEXT,
  latest_held_revision     TEXT,
  upstream_fingerprint     TEXT,      -- content identity within a single revision:
                                      -- catches a same-revision republish

  -- Populations are NULLABLE ON PURPOSE. NULL = not measured. A source we could
  -- not count must never render as 0 (Bug Prevention Rule #11 — `count ?? 0` is
  -- data fabrication).
  upstream_population   INTEGER CHECK (upstream_population IS NULL OR upstream_population >= 0),
  held_population       INTEGER CHECK (held_population     IS NULL OR held_population     >= 0),

  -- ── TWO ORTHOGONAL STATES ──────────────────────────────────────────────
  -- source_state moves ONLY on new data. intervention_state moves ONLY on human
  -- action. `content_stale` + `in_progress` is a normal Tuesday. A human
  -- acknowledgement must never be able to render the DATA current.
  source_state          TEXT NOT NULL CHECK (source_state IN
                          ('current','content_stale','upstream_quiet','unreachable','unmeasured')),
  intervention_state    TEXT NOT NULL CHECK (intervention_state IN
                          ('none_required','required','in_progress','blocked','completed')),

  manual_action_type    TEXT CHECK (manual_action_type IS NULL OR manual_action_type IN
                          ('refresh_upload','identity_resolution','controlled_import_required',
                           'credential_renewal','upstream_investigation')),
  runbook_path          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Readers: the control plane lists by dataset, and triages by the two states.
CREATE INDEX IF NOT EXISTS idx_dsi_dataset      ON data_source_instances (dataset_key);
CREATE INDEX IF NOT EXISTS idx_dsi_source_state ON data_source_instances (source_state);
CREATE INDEX IF NOT EXISTS idx_dsi_intervention ON data_source_instances (intervention_state);

ALTER TABLE data_source_instances ENABLE ROW LEVEL SECURITY;

-- ── NAVY LRAE — the first material source instance ─────────────────────────
-- Every machine field below is a MEASURED value, and from here on the daily Navy
-- watcher owns them. No human hand-stamps this row.
--
-- Navy passes DISCOVERY (we reliably find and fetch the newest workbook) and
-- fails IDENTITY: the reconciliation planner reproduced 0 of 8,821 held rows from
-- the published file. So the revision is current while the CONTENT is not —
-- which is exactly why revision and content are separate facts here.
INSERT INTO data_source_instances (
  dataset_key, source_key, name, discovery_url,
  ingest_mode, owner, watch_cadence_days,
  latest_upstream_revision, latest_held_revision,
  upstream_population, held_population,
  source_state, intervention_state, manual_action_type, runbook_path
) VALUES (
  'forecast_intelligence',
  'forecast_navy_lrae',
  'Navy LRAE',
  'https://www.secnav.navy.mil/rda/OneSource/Pages/LRAE.aspx',
  'manual',
  'eric',
  1,                       -- watched daily even though ingest is manual
  '02.2026',
  '02.2026',               -- revision matches; content does not
  9922,
  8821,
  'content_stale',         -- 9,922 upstream vs 8,821 held
  'required',
  'identity_resolution',   -- NOT refresh_upload: an upload would duplicate the corpus
  'docs/runbooks/navy-lrae.md'
)
ON CONFLICT (source_key) DO NOTHING;

-- ── correct the stale logical-dataset prose ────────────────────────────────
-- record_count is deliberately LEFT ALONE: it is legacy/advisory for this dataset
-- and the reader now derives the live figure from agency_forecasts with an exact
-- count. Replacing 7764 with another hand-typed number just restarts the rot.
UPDATE data_sources
   SET notes = 'Canonical store: agency_forecasts. Source-level operational truth: '
             || 'data_source_instances (one row per upstream source). Health derives from '
             || 'measured source state plus the canonical row count — NOT from forecast_sources, '
             || 'which is configuration only and is NOT a health authority. '
             || 'record_count on this row is legacy/advisory; readers measure agency_forecasts directly.',
       updated_at = NOW()
 WHERE key = 'forecast_intelligence';
