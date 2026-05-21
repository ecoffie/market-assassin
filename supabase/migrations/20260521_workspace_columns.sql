-- Workspace schema for /app — supports the workspace_id / owner_email /
-- created_by / updated_by columns the route code has been writing to
-- but the DB never had.
--
-- Originally this DDL lived inside `src/lib/app/workspace.ts` and was
-- supposed to self-apply via the `exec_migration` RPC. That never
-- actually ran on this Supabase instance, so every POST/PATCH against
-- /api/pipeline blew up with "Could not find the 'created_by' column"
-- (see commits bd994e6 + 017bec9 which shipped retry-without-workspace
-- fallbacks). This migration retires those workarounds — once it's
-- applied, the original code path works.
--
-- All ADD COLUMN statements use IF NOT EXISTS so re-runs are safe.

-- ---------------------------------------------------------------------
-- 1) Team membership table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mi_beta_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  invited_email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_mi_beta_team_member UNIQUE (workspace_id, user_email)
);

-- ---------------------------------------------------------------------
-- 2) Per-workspace user settings (NAICS, target agencies, frequency)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mi_beta_user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  company_name TEXT,
  display_name TEXT,
  role_title TEXT,
  naics_codes TEXT[],
  target_agencies TEXT[],
  email_frequency TEXT DEFAULT 'daily',
  onboarding_completed BOOLEAN DEFAULT false,
  two_factor_required BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_mi_beta_user_settings UNIQUE (user_email)
);

-- ---------------------------------------------------------------------
-- 3) Activity feed (audit log of writes across the workspace)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mi_beta_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4) Market focuses (saved searches per workspace)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mi_beta_market_focuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 5) Workspace columns on existing tables
-- ---------------------------------------------------------------------
-- These are the columns that were biting POST /api/pipeline + PATCH.
-- Adding them lets the route stop using the retry-without-workspace
-- shim — the original payload assignments succeed cleanly.
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Teaming partners shares the same workspace + audit columns. Add now
-- so the ContactsPanel CRUD (handleAdd/Update/Delete/TogglePursuit
-- wired in 53ea26f) doesn't blow up next time we touch that route.
ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ---------------------------------------------------------------------
-- 6) Comments (pipeline-row threaded discussion, used by Pursuit detail)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mi_beta_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 7) Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mi_beta_team_workspace ON mi_beta_team_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_settings_workspace ON mi_beta_user_settings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_activity_workspace ON mi_beta_activity(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_workspace ON mi_beta_market_focuses(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_user ON mi_beta_market_focuses(user_email, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_workspace ON user_pipeline(workspace_id);
CREATE INDEX IF NOT EXISTS idx_teaming_workspace ON user_teaming_partners(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_comments_pipeline ON mi_beta_comments(pipeline_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 8) Backfill workspace_id for existing rows
-- ---------------------------------------------------------------------
-- workspace_id is derived from user_email in `src/lib/app/workspace.ts`
-- via getWorkspaceId() — which lowercases + grabs the domain part as a
-- TEXT slug. For data already in user_pipeline / user_teaming_partners,
-- we don't have the original derivation function in SQL, so use the
-- domain of the email as a sensible default. ensureWorkspaceMember
-- will reconcile on next access.
UPDATE user_pipeline
   SET workspace_id = LOWER(SPLIT_PART(user_email, '@', 2)),
       owner_email = COALESCE(owner_email, user_email),
       created_by = COALESCE(created_by, user_email),
       updated_by = COALESCE(updated_by, user_email)
 WHERE workspace_id IS NULL;

UPDATE user_teaming_partners
   SET workspace_id = LOWER(SPLIT_PART(user_email, '@', 2)),
       owner_email = COALESCE(owner_email, user_email),
       created_by = COALESCE(created_by, user_email),
       updated_by = COALESCE(updated_by, user_email)
 WHERE workspace_id IS NULL;

-- Force PostgREST to reload the schema cache so the new columns are
-- visible to the API immediately. Without this, the next API call may
-- still hit "Could not find the X column" until the cache TTL expires.
NOTIFY pgrst, 'reload schema';
