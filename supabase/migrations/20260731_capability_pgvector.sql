-- pgvector for the Partner Finder capability search (Eric 2026-07-31).
--
-- WHY: capability-search paged 20,000 of 71,101 jsonb float[1536] embeddings over the wire and did
-- cosine in JS → ~43s per search (the Partner Finder "stuck on Matching against capability profiles"
-- symptom). This moves the similarity search INTO Postgres via pgvector: ORDER BY vec <=> query is an
-- indexed nearest-neighbour scan, ~sub-second, over ALL 71K (not a capped 20K sample), so recall
-- goes UP while latency goes from 43s to <1s.
--
-- Embeddings already exist as jsonb float[1536] in capability_embedding (71,101/71,101 populated).
-- This adds a real vector(1536) column + index; the search RPC below reads it.
--
-- Hand-run in the Supabase SQL editor (no in-app DDL). Idempotent — safe to re-run. The backfill is
-- the slow step (~71K rows) but runs once; re-runs skip already-copied rows.

-- 1. Extension (Supabase ships pgvector; this just enables it).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. A real vector column alongside the jsonb one (kept in sync going forward by the app writer).
ALTER TABLE public.contractor_capability_profiles
  ADD COLUMN IF NOT EXISTS capability_vec vector(1536);

-- 3. Backfill capability_vec from the existing jsonb array. jsonb float[1536] casts to text then to
--    vector cleanly ([-0.01,...] is valid vector input). Only fill rows not yet done (resumable).
UPDATE public.contractor_capability_profiles
SET capability_vec = (capability_embedding::text)::vector
WHERE capability_vec IS NULL
  AND capability_embedding IS NOT NULL;

-- 4. HNSW index for cosine distance (<=>). HNSW needs no training (unlike ivfflat), gives strong
--    recall, and is the right pick at 71K rows. cosine because the embeddings are normalized-ish and
--    the JS path used cosineSimilarity.
CREATE INDEX IF NOT EXISTS contractor_capability_vec_hnsw_idx
  ON public.contractor_capability_profiles
  USING hnsw (capability_vec vector_cosine_ops);

-- 5. The search RPC — nearest neighbours by cosine, optional state filter + min award count. Returns
--    similarity = 1 - cosine_distance so the app's 0..1 similarity semantics are unchanged. The app
--    calls this instead of paging embeddings over the wire.
CREATE OR REPLACE FUNCTION public.capability_semantic_search(
  query_vec vector(1536),
  match_limit int DEFAULT 25,
  filter_state text DEFAULT NULL,
  min_awards int DEFAULT 0
)
RETURNS TABLE (
  rollup_uei text,
  rollup_name text,
  state text,
  capability_label text,
  capability_summary text,
  specialty_tier text,
  award_count int,
  total_obligated numeric,
  similarity double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT p.rollup_uei, p.rollup_name, p.state, p.capability_label, p.capability_summary,
         p.specialty_tier, p.award_count, p.total_obligated,
         1 - (p.capability_vec <=> query_vec) AS similarity
  FROM public.contractor_capability_profiles p
  WHERE p.capability_vec IS NOT NULL
    AND (filter_state IS NULL OR p.state = filter_state)
    AND (min_awards <= 0 OR p.award_count >= min_awards)
  ORDER BY p.capability_vec <=> query_vec
  LIMIT match_limit;
$$;

-- Verify:
--   SELECT count(*) FROM contractor_capability_profiles WHERE capability_vec IS NOT NULL; -- ~71,101
--   SELECT indexname FROM pg_indexes WHERE tablename='contractor_capability_profiles' AND indexname LIKE '%vec%';
