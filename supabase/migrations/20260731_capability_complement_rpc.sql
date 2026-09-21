-- pgvector RPC for the Partner Finder "Complement a firm" mode (Eric 2026-07-31).
--
-- The complement mode was still on the 43s JS scan (paging 20K embeddings + cosine in JS). This
-- moves it to an indexed pgvector query like the "Describe the work" search, but with the extra
-- COMPLEMENT logic that IS the feature: keep firms in a similarity BAND [min, max] around the
-- anchor — close enough to team, but EXCLUDING near-duplicates (> max = competitors, not partners) —
-- plus a belt-and-braces exclusion of the identical capability_label.
--
-- Uses the anchor's OWN stored capability_vec as the query point (no client embedding needed — the
-- anchor is already in the table). Requires the capability_vec column + HNSW index from
-- 20260731_capability_pgvector.sql (run that first). Hand-run in the Supabase SQL editor. Idempotent.

CREATE OR REPLACE FUNCTION public.capability_complement_search(
  anchor_uei text,
  match_limit int DEFAULT 25,
  min_sim double precision DEFAULT 0.6,
  max_sim double precision DEFAULT 0.75,
  filter_state text DEFAULT NULL
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
  similarity double precision,
  anchor_name text
)
LANGUAGE sql STABLE
AS $$
  WITH a AS (
    SELECT capability_vec, capability_label, rollup_name
    FROM public.contractor_capability_profiles
    WHERE rollup_uei = anchor_uei AND capability_vec IS NOT NULL
    LIMIT 1
  )
  SELECT p.rollup_uei, p.rollup_name, p.state, p.capability_label, p.capability_summary,
         p.specialty_tier, p.award_count, p.total_obligated,
         1 - (p.capability_vec <=> a.capability_vec) AS similarity,
         a.rollup_name AS anchor_name
  FROM public.contractor_capability_profiles p, a
  WHERE p.capability_vec IS NOT NULL
    AND p.rollup_uei <> anchor_uei
    -- the BAND: adjacent enough to team, distinct enough not to compete
    AND (1 - (p.capability_vec <=> a.capability_vec)) >= min_sim
    AND (1 - (p.capability_vec <=> a.capability_vec)) <= max_sim
    -- an IDENTICAL capability label is a competitor by definition, whatever the cosine says
    AND (a.capability_label IS NULL OR p.capability_label IS DISTINCT FROM a.capability_label)
    AND (filter_state IS NULL OR p.state = filter_state)
  ORDER BY p.capability_vec <=> a.capability_vec   -- nearest first (highest similarity)
  LIMIT match_limit;
$$;

-- Verify:
--   SELECT rollup_name, round(similarity::numeric,3) FROM capability_complement_search(
--     (SELECT rollup_uei FROM contractor_capability_profiles WHERE capability_vec IS NOT NULL LIMIT 1), 5);
