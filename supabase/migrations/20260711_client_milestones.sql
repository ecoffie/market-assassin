-- Capability Milestones (PRD-capability-milestones-funder-report). Org/Coach layer.
--
-- One row per (org_client, milestone) tracking a managed client business through 5
-- capability milestones. 2 auto (first_bid, first_award — detected from user_pipeline
-- stages) + 3 manual (sam_registration, certification, capability_statement — counselor
-- checkbox, no data source).
--
-- ISOLATION (PRD §8a): this table is keyed to org_clients, which only exists for
-- businesses a center added — so it CANNOT hold a row for a normal solo Mindy user's
-- workspace. Additive migration only: it does NOT alter user_pipeline,
-- user_notification_settings, org_clients, or any shared table.
--
-- Hand-run in the Supabase SQL editor, then it NOTIFYs pgrst to reload the schema.

CREATE TABLE IF NOT EXISTS client_milestones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_client_id  UUID NOT NULL REFERENCES org_clients(id) ON DELETE CASCADE,
  workspace_id   TEXT NOT NULL,                 -- denormalized for fast org-scoped rollup
  milestone_key  TEXT NOT NULL,                 -- sam_registration | certification | capability_statement | first_bid | first_award
  achieved_at    TIMESTAMPTZ,                   -- when the milestone was reached (null = not yet)
  source         TEXT NOT NULL DEFAULT 'manual',-- auto | manual
  marked_by      TEXT,                          -- counselor user_email (manual milestones only)
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_client_milestone UNIQUE (org_client_id, milestone_key),
  CONSTRAINT valid_milestone_key CHECK (
    milestone_key IN ('sam_registration','certification','capability_statement','first_bid','first_award')
  ),
  CONSTRAINT valid_milestone_source CHECK (source IN ('auto','manual'))
);

CREATE INDEX IF NOT EXISTS idx_client_milestones_client ON client_milestones (org_client_id);
CREATE INDEX IF NOT EXISTS idx_client_milestones_ws ON client_milestones (workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_milestones_key ON client_milestones (milestone_key, achieved_at);

-- RLS mirrors org_clients: enable RLS; the app reaches this table ONLY through the
-- service-role client in the coach route (which itself enforces org_admin / assigned-coach
-- authorization in code — same pattern as org_clients access today). Enabling RLS with no
-- permissive policy blocks the anon/auth keys entirely; service-role bypasses RLS.
ALTER TABLE client_milestones ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
