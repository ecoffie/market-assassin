-- Auto-library: searchable history of every AI output Mindy generates
-- for the user. Content Reaper pattern #4 — fire-and-forget write
-- after every generation, surfaced as a per-user searchable archive.
--
-- Stored content types:
--   - briefing          → daily / weekly / pursuit briefings sent
--   - proposal_section  → individual proposal section drafts
--   - cap_statement     → capability statement sections
--   - vault_ai_coach    → Day 0 AI-drafted capability profile (from prefill)
--
-- Strategy: store the AI output payload + a thin set of searchable
-- fields (title, subtype, agency, naics_code). Full search uses Postgres
-- full-text on the title + content_text columns.
--
-- The user keeps complete history. They can recall any past output by
-- title, by agency, by NAICS, or by free-text search. This is the
-- "Loom for content" pattern that turns one-shot AI into an engine.
--
-- Built 2026-05-27 from the Content Reaper audit.

CREATE TABLE IF NOT EXISTS user_generated_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_email TEXT NOT NULL,

  -- What kind of content
  content_type TEXT NOT NULL,  -- 'briefing' | 'proposal_section' | 'cap_statement' | 'vault_ai_coach'
  content_subtype TEXT,        -- 'daily' / 'weekly' / 'pursuit' for briefings; section type for proposals

  -- Searchable display fields (denormalized for fast list queries)
  title TEXT NOT NULL,
  agency TEXT,
  naics_code TEXT,
  /* AI provider + model so we can debug regressions later */
  ai_provider TEXT,
  ai_model TEXT,

  -- Payload (JSONB so we can store rich structured output)
  content JSONB NOT NULL,

  -- Plain-text excerpt for full-text search + list previews
  -- (extracted from content at write time so search doesn't have to
  --  walk the JSONB)
  content_text TEXT,

  -- Optional pursuit/source link
  pursuit_id UUID,         -- if generated from a pipeline pursuit
  source_notice_id TEXT,   -- SAM notice ID if applicable

  -- Tags for filtering
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ  -- soft-delete (user-initiated)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_archive_user
  ON user_generated_archive(user_email, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_archive_type
  ON user_generated_archive(user_email, content_type, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_archive_pursuit
  ON user_generated_archive(pursuit_id)
  WHERE pursuit_id IS NOT NULL;

-- Full-text search index on title + content_text
CREATE INDEX IF NOT EXISTS idx_archive_fts
  ON user_generated_archive
  USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, '')));

COMMENT ON TABLE user_generated_archive IS
  'Auto-library — every AI output (briefing, proposal section, cap statement, vault AI coach) silently persists here so users can recall + reuse. Content Reaper pattern #4.';

NOTIFY pgrst, 'reload schema';
