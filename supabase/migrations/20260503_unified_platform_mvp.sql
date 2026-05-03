-- Unified Platform MVP Migration
-- Created: May 3, 2026
-- Purpose: OpenGovIQ migration - adds contacts and conversations tables
-- Note: user_pipeline and pipeline_history already exist from 20260410_bd_assist_pipeline.sql

-- =============================================
-- 1. CONTACTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,  -- Using email instead of user_id for simplicity
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  title TEXT,
  agency TEXT,  -- Federal agency if applicable
  notes TEXT,
  tags TEXT[],  -- Array of tags for categorization
  source TEXT DEFAULT 'manual',  -- 'manual', 'base44_import', 'sam_gov'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for contacts
CREATE INDEX IF NOT EXISTS idx_contacts_user_email ON contacts(user_email);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);
CREATE INDEX IF NOT EXISTS idx_contacts_agency ON contacts(agency);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);

-- =============================================
-- 2. CONVERSATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,

  -- Conversation content
  content TEXT NOT NULL,
  conversation_type TEXT DEFAULT 'note' CHECK (conversation_type IN (
    'note',      -- General note
    'email',     -- Email sent/received
    'call',      -- Phone call
    'meeting',   -- In-person or virtual meeting
    'linkedin'   -- LinkedIn message
  )),

  -- Optional: link to pipeline item (uses existing user_pipeline table)
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE SET NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for conversations
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_email ON conversations(user_email);
CREATE INDEX IF NOT EXISTS idx_conversations_pipeline_id ON conversations(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- =============================================
-- 3. TRIGGER: Auto-update updated_at for contacts
-- =============================================
-- (update_updated_at_column function already exists from pipeline migration)

DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 4. ADD winner COLUMN TO user_pipeline (if missing)
-- =============================================
-- For tracking who won lost opportunities
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_pipeline' AND column_name = 'winner'
  ) THEN
    ALTER TABLE user_pipeline ADD COLUMN winner TEXT;
    COMMENT ON COLUMN user_pipeline.winner IS 'Company name that won (for lost opportunities)';
  END IF;
END $$;

-- =============================================
-- 5. RLS POLICIES (Row Level Security)
-- =============================================

-- Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- For now, allow service role full access (we authenticate at API level)
CREATE POLICY IF NOT EXISTS "Service role has full access to contacts"
  ON contacts FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role has full access to conversations"
  ON conversations FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Run these after migration to verify:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name IN ('contacts', 'conversations', 'user_pipeline');
--
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('contacts', 'conversations');
--
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'contacts';
