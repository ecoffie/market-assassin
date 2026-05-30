-- Adds business_type, transcript_keywords, personas to podcast_episode_metadata.
-- Lets retrieval distinguish product-sales episodes from service episodes
-- and route queries like "product sales with Ryan Atencio" → ep 63
-- (the episode Ryan talks about GSA Schedules, distributors, etc.)
-- without depending on summary text overlap.

ALTER TABLE podcast_episode_metadata
  ADD COLUMN IF NOT EXISTS business_type text,           -- 'product' | 'service' | 'both' | null
  ADD COLUMN IF NOT EXISTS transcript_keywords jsonb,    -- top 15 distinctive nouns/phrases
  ADD COLUMN IF NOT EXISTS personas jsonb;               -- ['first-time-bidder', 'veteran', 'product-reseller', ...]

-- Indexes for the new search paths
CREATE INDEX IF NOT EXISTS idx_pem_business_type
  ON podcast_episode_metadata (business_type)
  WHERE extraction_status = 'extracted';

CREATE INDEX IF NOT EXISTS idx_pem_transcript_keywords
  ON podcast_episode_metadata USING gin (transcript_keywords);

CREATE INDEX IF NOT EXISTS idx_pem_personas
  ON podcast_episode_metadata USING gin (personas);

-- Trigram index on guest_name so "atencio" matches without LIKE bleed
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_pem_guest_name_trgm
  ON podcast_episode_metadata USING gin (guest_name gin_trgm_ops);
