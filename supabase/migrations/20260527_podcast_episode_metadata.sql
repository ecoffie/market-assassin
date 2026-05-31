-- Structured metadata extracted from GovCon Giants Podcast transcripts.
--
-- The raw transcripts in mindy_rag_documents are great for FTS, but
-- they don't let us answer questions like "show every guest who
-- mentioned an 8(a) certification" or "which episodes name NAICS
-- 541512" without re-scanning the chunks. This table extracts that
-- shape once per episode via a Groq Llama pass, so the answers are
-- structured and queryable.
--
-- Built 2026-05-27 in parallel with the Phase 2 Whisper batch (#115).
-- One row per podcast_interview document, joined back via document_id.
--
-- Status lifecycle: pending → extracted | failed
-- Re-run with --force to refresh.
CREATE TABLE IF NOT EXISTS podcast_episode_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The mindy_rag_documents row this metadata describes
  document_id UUID NOT NULL REFERENCES mindy_rag_documents(id) ON DELETE CASCADE UNIQUE,

  -- From the episode title / show notes (not LLM-extracted)
  episode_number INT,
  episode_title TEXT,
  episode_url TEXT,

  -- LLM-extracted structured intel
  guest_name TEXT,                              -- "Maria Lopez" (null for solo/host episodes)
  guest_company TEXT,                           -- "Lopez Construction LLC"
  guest_role TEXT,                              -- "CEO" / "Founder" / "Director of BD"
  topics TEXT[] DEFAULT ARRAY[]::TEXT[],        -- ['teaming-agreements', 'set-asides', 'construction']
  naics_mentioned TEXT[] DEFAULT ARRAY[]::TEXT[],
  agencies_mentioned TEXT[] DEFAULT ARRAY[]::TEXT[],  -- ['Army Corps of Engineers', 'NAVFAC', 'GSA']
  set_asides_mentioned TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['8(a)', 'WOSB', 'HUBZone']
  contract_size_mentioned TEXT,                  -- "$4.2M" / "$50K" / "low-7-figure"
  key_lessons TEXT[] DEFAULT ARRAY[]::TEXT[],    -- 3-5 short takeaways from the guest
  summary_2sent TEXT,                            -- 2-3 sentence hook for search-result snippets

  -- Extraction lifecycle
  extraction_status TEXT NOT NULL DEFAULT 'pending',  -- pending | extracted | failed
  extraction_error TEXT,
  extraction_model TEXT,
  extracted_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Targeted indexes for the most likely retrieval patterns
CREATE INDEX IF NOT EXISTS idx_pem_status ON podcast_episode_metadata(extraction_status);
CREATE INDEX IF NOT EXISTS idx_pem_guest_name ON podcast_episode_metadata(LOWER(guest_name)) WHERE guest_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pem_naics ON podcast_episode_metadata USING GIN (naics_mentioned);
CREATE INDEX IF NOT EXISTS idx_pem_agencies ON podcast_episode_metadata USING GIN (agencies_mentioned);
CREATE INDEX IF NOT EXISTS idx_pem_set_asides ON podcast_episode_metadata USING GIN (set_asides_mentioned);
CREATE INDEX IF NOT EXISTS idx_pem_topics ON podcast_episode_metadata USING GIN (topics);

COMMENT ON TABLE podcast_episode_metadata IS
  'Structured intel extracted by Groq Llama from podcast transcripts. One row per podcast_interview document. Enables pivots like "find every episode mentioning NAICS X" or "which guests at companies in agency Y won contracts" without re-scanning chunks.';

NOTIFY pgrst, 'reload schema';
