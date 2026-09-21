-- Partner Finder "Complement a firm" RPC — v2, index-friendly (Eric 2026-07-31).
--
-- v1 (20260731_capability_complement_rpc.sql) TIMED OUT: it filtered a similarity BAND
-- (WHERE 1-(vec<=>anchor) BETWEEN 0.6 AND 0.75) across all 71K rows. HNSW can't use a range
-- predicate — only ORDER BY vec <=> anchor LIMIT k (nearest-neighbour) — so v1 did a full seq scan
-- of every vector → statement timeout.
--
-- v2: let the HNSW index do what it's good at — grab the top-K NEAREST candidates (fast, indexed) —
-- THEN apply the complement band + label exclusion on that small candidate set in an outer query.
-- The band lives at the TOP of the nearest-neighbour list (complements are 0.6–0.75, just below the
-- 0.75+ competitors), so a generous candidate pool (default 400) comfortably contains all of them.

CREATE OR REPLACE FUNCTION public.capability_complement_search(
  anchor_uei text,
  match_limit int DEFAULT 25,
  min_sim double precision DEFAULT 0.6,
  max_sim double precision DEFAULT 0.75,
  filter_state text DEFAULT NULL,
  candidate_pool int DEFAULT 400
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
  ),
  -- INDEXED nearest-neighbour scan: HNSW handles ORDER BY <=> LIMIT fast. Pull a generous pool of the
  -- closest firms; the complement band sits at the top of this list.
  candidates AS (
    SELECT p.rollup_uei, p.rollup_name, p.state, p.capability_label, p.capability_summary,
           p.specialty_tier, p.award_count, p.total_obligated,
           1 - (p.capability_vec <=> a.capability_vec) AS similarity,
           a.capability_label AS anchor_label, a.rollup_name AS anchor_name
    FROM public.contractor_capability_profiles p, a
    WHERE p.capability_vec IS NOT NULL
      AND p.rollup_uei <> anchor_uei
      AND (filter_state IS NULL OR p.state = filter_state)
    ORDER BY p.capability_vec <=> a.capability_vec
    LIMIT candidate_pool
  )
  -- Apply the COMPLEMENT band + identical-label exclusion on the small candidate set.
  SELECT c.rollup_uei, c.rollup_name, c.state, c.capability_label, c.capability_summary,
         c.specialty_tier, c.award_count, c.total_obligated, c.similarity, c.anchor_name
  FROM candidates c
  WHERE c.similarity >= min_sim
    AND c.similarity <= max_sim
    AND (c.anchor_label IS NULL OR c.capability_label IS DISTINCT FROM c.anchor_label)
  ORDER BY c.similarity DESC
  LIMIT match_limit;
$$;

-- Verify (should return in ms, not time out):
--   SELECT rollup_name, capability_label, round(similarity::numeric,3)
--   FROM capability_complement_search(
--     (SELECT rollup_uei FROM contractor_capability_profiles WHERE capability_label='Fruits and vegetables'
--      AND capability_vec IS NOT NULL LIMIT 1), 6);
