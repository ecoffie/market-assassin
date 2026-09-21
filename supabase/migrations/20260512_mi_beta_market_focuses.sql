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

CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_workspace
  ON mi_beta_market_focuses(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_user
  ON mi_beta_market_focuses(user_email, updated_at DESC);
