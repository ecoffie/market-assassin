-- Partner Finder "Complement a firm" RPC — v3, plpgsql so HNSW actually fires (Eric 2026-07-31).
--
-- v2 still TIMED OUT: the anchor vector came from a CTE (FROM profiles p, a ... ORDER BY
-- p.capability_vec <=> a.capability_vec). HNSW can only accelerate ORDER BY vec <=> <CONSTANT> — a
-- CORRELATED column (a.capability_vec) isn't a constant to the planner, so it seq-scanned all 71K.
--
-- v3: load the anchor vector into a LOCAL variable first (plpgsql), THEN run the nearest-neighbour
-- scan with that variable as the query point — now it's a bind value the HNSW index CAN use. Same
-- signature as v2 (candidate_pool default), so the app call is unchanged. CREATE OR REPLACE keeps
-- the single 6-arg overload.

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
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_vec   vector(1536);
  v_label text;
  v_name  text;
BEGIN
  -- 1. Anchor's own vector into a LOCAL (a real constant for the index).
  SELECT p.capability_vec, p.capability_label, p.rollup_name
    INTO v_vec, v_label, v_name
  FROM public.contractor_capability_profiles p
  WHERE p.rollup_uei = anchor_uei AND p.capability_vec IS NOT NULL
  LIMIT 1;

  IF v_vec IS NULL THEN
    RETURN; -- no anchor / no embedding → empty
  END IF;

  -- 2. INDEXED nearest-neighbour pool (v_vec is a bind value → HNSW fires), then the complement band.
  RETURN QUERY
  WITH candidates AS (
    SELECT p.rollup_uei, p.rollup_name, p.state, p.capability_label, p.capability_summary,
           p.specialty_tier, p.award_count, p.total_obligated,
           1 - (p.capability_vec <=> v_vec) AS sim
    FROM public.contractor_capability_profiles p
    WHERE p.capability_vec IS NOT NULL
      AND p.rollup_uei <> anchor_uei
      AND (filter_state IS NULL OR p.state = filter_state)
    ORDER BY p.capability_vec <=> v_vec
    LIMIT candidate_pool
  )
  SELECT c.rollup_uei, c.rollup_name, c.state, c.capability_label, c.capability_summary,
         c.specialty_tier, c.award_count, c.total_obligated, c.sim, v_name
  FROM candidates c
  WHERE c.sim >= min_sim
    AND c.sim <= max_sim
    AND (v_label IS NULL OR c.capability_label IS DISTINCT FROM v_label)
  ORDER BY c.sim DESC
  LIMIT match_limit;
END;
$$;

-- Verify (should return in ms):
--   SELECT rollup_name, capability_label, round(similarity::numeric,3)
--   FROM capability_complement_search(
--     (SELECT rollup_uei FROM contractor_capability_profiles WHERE capability_label='Fruits and vegetables'
--      AND capability_vec IS NOT NULL LIMIT 1), 6);
