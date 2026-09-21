-- MI Beta Relationships Schema
-- Tables for My Network / Relationships panel

-- Main contacts table
CREATE TABLE IF NOT EXISTS mi_beta_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  contact_type TEXT NOT NULL DEFAULT 'partner',
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  organization TEXT,
  agency TEXT,
  office TEXT,
  sub_tier TEXT,
  source TEXT DEFAULT 'manual',
  source_record_id TEXT,
  notes TEXT,
  owner_email TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contact-to-opportunity links
CREATE TABLE IF NOT EXISTS mi_beta_contact_opportunity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  contact_id UUID NOT NULL REFERENCES mi_beta_contacts(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
  relationship_role TEXT DEFAULT 'contact',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_mi_beta_contact_pipeline UNIQUE (contact_id, pipeline_id)
);

-- Pursuit activity log
CREATE TABLE IF NOT EXISTS mi_beta_pursuit_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  pipeline_id UUID,
  actor_email TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_workspace ON mi_beta_contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_email ON mi_beta_contacts(email);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_type ON mi_beta_contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_workspace ON mi_beta_contact_opportunity_links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_pipeline ON mi_beta_contact_opportunity_links(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_pursuit_activity_workspace ON mi_beta_pursuit_activity(workspace_id, created_at DESC);
