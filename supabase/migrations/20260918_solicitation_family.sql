-- Solicitation Family v1 — durable identity + aliases + version history.
--
-- This is NOT a lifecycle procurement entity. Forecasts, awards, recompetes,
-- and PAE relationships stay external. Families are created lazily (known-ID,
-- pursuit save, confirmed multi-notice / dual-ID backfill) — never one row
-- per sam_opportunities notice.
--
-- identity_key:
--   sol:<NORMALIZED_SOLICITATION_NUMBER>  — confirmed SAM family
--   nid:<notice_id>                       — singleton with no SAM sol #
-- Never keyed by title, DoDAAC, NAICS, PSC, incumbent, or buyer.

CREATE TABLE IF NOT EXISTS solicitation_family (
  family_id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key                      TEXT NOT NULL UNIQUE,
  canonical_solicitation_number     TEXT,
  current_notice_id                 TEXT NOT NULL,
  current_status                    TEXT,
  current_deadline                  TIMESTAMPTZ,
  current_amendment                 TEXT,
  current_set_aside                 TEXT,
  canonical_title                   TEXT,
  primary_dodaac                    TEXT,
  department                        TEXT,
  sub_tier                          TEXT,
  office                            TEXT,
  current_contact                   JSONB,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitation_family_current_notice
  ON solicitation_family (current_notice_id);

CREATE INDEX IF NOT EXISTS idx_solicitation_family_dodaac
  ON solicitation_family (primary_dodaac)
  WHERE primary_dodaac IS NOT NULL;

COMMENT ON TABLE solicitation_family IS
  'Confirmed SAM solicitation identity. Not a PAE, forecast, award, or lifecycle super-entity.';

CREATE TABLE IF NOT EXISTS solicitation_family_versions (
  family_id           UUID NOT NULL REFERENCES solicitation_family(family_id) ON DELETE CASCADE,
  notice_id           TEXT NOT NULL,
  posted_date         TIMESTAMPTZ,
  response_deadline   TIMESTAMPTZ,
  amendment           TEXT,
  active              BOOLEAN,
  title               TEXT,
  PRIMARY KEY (family_id, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_solicitation_family_versions_notice
  ON solicitation_family_versions (notice_id);

COMMENT ON TABLE solicitation_family_versions IS
  'Historical notice versions. Deadlines and documents stay on the version; never overwrite.';

CREATE TABLE IF NOT EXISTS solicitation_identifiers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES solicitation_family(family_id) ON DELETE CASCADE,
  identifier_type    TEXT NOT NULL,
  identifier_value   TEXT NOT NULL,
  identifier_norm    TEXT NOT NULL,
  source             TEXT NOT NULL,
  evidence_grade     TEXT NOT NULL,
  effective_from     TIMESTAMPTZ,
  effective_to       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identifier_norm, identifier_type)
);

CREATE INDEX IF NOT EXISTS idx_solicitation_identifiers_family
  ON solicitation_identifiers (family_id);

CREATE INDEX IF NOT EXISTS idx_solicitation_identifiers_norm
  ON solicitation_identifiers (identifier_norm);

COMMENT ON TABLE solicitation_identifiers IS
  'CONFIRMED_IDENTITY aliases only in v1 (SAM sol #, notice_id, official RFP/document tokens). SUPPORTED/CANDIDATE links are not stored as identity.';

ALTER TABLE user_pipeline
  ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES solicitation_family(family_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_pipeline_family
  ON user_pipeline (family_id)
  WHERE family_id IS NOT NULL;

COMMENT ON COLUMN user_pipeline.family_id IS
  'Solicitation family this pursuit attaches to. notice_id remains the worked-from version; never rewritten.';

ALTER TABLE pursuit_monitor_state
  ADD COLUMN IF NOT EXISTS last_current_notice_id TEXT;

COMMENT ON COLUMN pursuit_monitor_state.last_current_notice_id IS
  'Family current notice_id at last check. Used to detect NEW_VERSION sibling amendments without rewriting worked-from notice_id.';

ALTER TABLE solicitation_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitation_family_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitation_identifiers ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
