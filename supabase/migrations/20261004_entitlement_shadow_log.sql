-- R2 — entitlement SHADOW storage. Nothing in the product reads either table to decide access.
--
-- Creates two NEW tables and nothing else:
--   * no ALTER of any existing table, no UPDATE/DELETE/INSERT of existing data,
--   * no triggers, no functions, no foreign keys, no views, no grants beyond RLS (service role only).
-- Dropping both tables returns the database to its prior state.

-- 1) The shadow comparison log: one row per shadowed gated request when ENTITLEMENT_SHADOW=true.
--    No email is stored: subject_key is a keyed HMAC, enough to count distinct accounts.
--    Retention: rows older than 30 days are deleted by /api/cron/reconcile-entitlement-sources.
CREATE TABLE IF NOT EXISTS entitlement_shadow_log (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  route             TEXT NOT NULL,
  capability        TEXT NOT NULL,
  current_allow     BOOLEAN NOT NULL,
  canonical         TEXT NOT NULL CHECK (canonical IN ('allow', 'deny', 'unknown')),
  agrees            BOOLEAN,
  source_categories TEXT[] NOT NULL DEFAULT '{}',
  reason            TEXT NOT NULL,
  subject_key       TEXT
);

-- Retention scans by age; the report reads disagreements by capability.
CREATE INDEX IF NOT EXISTS entitlement_shadow_log_created_idx ON entitlement_shadow_log (created_at);
CREATE INDEX IF NOT EXISTS entitlement_shadow_log_disagree_idx
  ON entitlement_shadow_log (capability, created_at) WHERE agrees IS NOT TRUE;

ALTER TABLE entitlement_shadow_log ENABLE ROW LEVEL SECURITY;

-- 2) Shadow-only source EVIDENCE the canonical resolver reads and no gate does:
--    * source='membership' / 'membership_unruled' — Stripe subscriptions observed by the
--      reconciler (evidence_key = subscription id; status active | past_due | ended).
--    * source='legacy_mindy_grandfather' — the frozen D1 cohort (evidence_key = cohort id).
--    Bounded by construction: one row per (source, evidence_key); ~100 rows today.
CREATE TABLE IF NOT EXISTS entitlement_source_observations (
  id                BIGSERIAL PRIMARY KEY,
  email             TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('membership', 'membership_unruled', 'legacy_mindy_grandfather')),
  evidence_key      TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'ended')),
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  UNIQUE (source, evidence_key)
);

CREATE INDEX IF NOT EXISTS entitlement_source_observations_email_idx ON entitlement_source_observations (email);

ALTER TABLE entitlement_source_observations ENABLE ROW LEVEL SECURITY;
-- Both tables: service role only (no policies). Nothing client-side reads or writes them.
