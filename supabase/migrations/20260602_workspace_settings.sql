-- Workspace-level defaults (company, NAICS, agencies) shared by all members of
-- a team workspace. Distinct from the per-user mi_beta_user_settings row.
-- Powers the TeamPanel "Workspace Settings" panel so team defaults apply to the
-- whole workspace instead of just the admin's personal settings.
--
-- Run in the Supabase SQL editor (the exec_migration RPC is not available in
-- this project, so ensureAppWorkspaceSchema cannot create this automatically).

CREATE TABLE IF NOT EXISTS mi_beta_workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  company_name TEXT,
  default_naics_codes TEXT[],
  default_agencies TEXT[],
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_mi_beta_workspace_settings UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_mi_beta_workspace_settings_workspace
  ON mi_beta_workspace_settings(workspace_id);
