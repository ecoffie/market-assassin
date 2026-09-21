-- Coach Mode / Org White-Label v1 (PRD-coach-mode-apex). APEX = instance #1.
--
-- An ORGANIZATION (APEX Illinois, an SBDC, a Chamber…) has coaches and clients.
-- Each CLIENT business = a workspace (reuses workspace_id everywhere). A coach
-- is a member of the org and is assigned to client workspaces; switching the
-- active workspace makes the whole app operate as that client.
--
-- Hand-run in the Supabase SQL editor, then NOTIFY pgrst.

-- The partner organization (white-label tenant).
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  org_type    TEXT DEFAULT 'apex',     -- apex | sbdc | chamber | fhc | other
  tab_label   TEXT DEFAULT 'Org Tab',  -- branded "APEX Tab" / "SBDC Tab"
  logo_url    TEXT,
  brand_color TEXT,
  tier        TEXT DEFAULT 'enterprise',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- People in an org: coaches, client owners, org admins.
CREATE TABLE IF NOT EXISTS org_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'coach',   -- coach | client_owner | org_admin
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_org_member UNIQUE (org_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_org_members_email ON org_members (user_email, status);

-- A client business managed under an org. business = a workspace_id (reuses all
-- the workspace-scoped data: pipeline, vault, relationships, proposals…).
CREATE TABLE IF NOT EXISTS org_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,            -- the client's workspace
  business_name   TEXT NOT NULL,
  primary_email   TEXT,                     -- client owner, if any
  assigned_coach  TEXT,                     -- coach user_email (nullable)
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_org_client_ws UNIQUE (org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_org_clients_org ON org_clients (org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_clients_coach ON org_clients (assigned_coach, status);

-- Internal org news feed (org_admin posts; shows in the Org Tab).
CREATE TABLE IF NOT EXISTS org_news (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  pinned      BOOLEAN DEFAULT FALSE,
  posted_by   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_news_org ON org_news (org_id, pinned, created_at DESC);

NOTIFY pgrst, 'reload schema';
