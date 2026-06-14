-- pursuit_compliance — the persisted, team-shared compliance matrix per pursuit.
--
-- Today the panel's compliance matrix lives only in React state: it re-runs and
-- RESETS on every reload, and the per-row owner/status edits (team check-off) are
-- saved nowhere. This table persists the matrix so it survives reload AND lets
-- teammates see/own/check-off individual requirements (workspace-shared).
--
-- One row PER REQUIREMENT (not a blob) so check-off is a cheap per-row update and
-- "my items" / progress roll-up are simple queries. Scoped to the pursuit; the
-- workspace sharing rides on user_pipeline's existing workspace_id (a pursuit owned
-- by a workspace is visible to its members via the same path the wizard uses).
--
-- Mirrors pursuit_documents: pipeline_id FK + ON DELETE CASCADE, user_email for
-- non-workspace pursuits. No in-app DDL on this DB — run this by hand in Supabase.

CREATE TABLE IF NOT EXISTS pursuit_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership / scope
  pipeline_id UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,          -- who generated/owns the pursuit (workspace rides on user_pipeline.workspace_id)

  -- The requirement (from the compliance extraction). req_key is a stable id
  -- WITHIN a pursuit so a re-extraction can upsert the same row and KEEP the
  -- owner/status the team already set, instead of wiping their work.
  req_key TEXT NOT NULL,             -- stable per-pursuit requirement id (e.g. the extraction id or a hash)
  requirement TEXT NOT NULL,
  category TEXT,                     -- submission | evaluation | technical | past_performance | pricing | admin | other
  section TEXT,                      -- L.3.2, M-2, C.5, ...
  source_quote TEXT,
  source_doc TEXT,                   -- "Amendment 0004"
  revised BOOLEAN DEFAULT FALSE,

  -- Team check-off (the whole point — these PERSIST and are shared)
  owner TEXT DEFAULT '',             -- teammate assigned (free text / email)
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | done | n_a

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per requirement per pursuit. Upsert target → re-extraction preserves
  -- the team's owner/status on rows whose req_key is unchanged.
  UNIQUE (pipeline_id, req_key)
);

CREATE INDEX IF NOT EXISTS idx_pursuit_compliance_pipeline ON pursuit_compliance (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pursuit_compliance_owner ON pursuit_compliance (owner) WHERE owner <> '';
CREATE INDEX IF NOT EXISTS idx_pursuit_compliance_status ON pursuit_compliance (pipeline_id, status);
