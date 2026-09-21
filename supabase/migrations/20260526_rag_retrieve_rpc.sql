-- RAG retrieval quality fix
--
-- Problem observed in smoke test (3,450 chunks across 548 docs):
--   Every query returned the same 5 meta-documents (CONTENT-MAPPING,
--   PROGRESS-REPORT, BENCHMARK, GAP-ANALYSIS) because they list every
--   topic name in passing — so they match every token. PostgREST's
--   .textSearch() also doesn't apply ts_rank, so ordering was
--   approximately-random.
--
-- Fix:
--   1. Reclassify obvious meta-docs into doc_type='meta_doc' so
--      they're excluded from default proposal retrieval.
--   2. Provide a get_rag_chunks() RPC that uses ts_rank_cd properly
--      and boosts on-topic doc_types over generic ones.
--   3. retrieve.ts calls this RPC instead of .textSearch().

-- ---- (1) Reclassify meta-docs --------------------------------------
-- Match by filename (raw, dash-preserving). These are documentation
-- ABOUT the corpus, not teaching content. We match filename not title
-- because the ingest pass extracted titles from H1 headings which
-- stripped the dash-separated tokens we look for.
UPDATE mindy_rag_documents
SET doc_type = 'meta_doc'
WHERE doc_type IN ('misc', 'planner_app_code')
  AND (
    upper(filename) LIKE '%CONTENT-MAPPING%'
    OR upper(filename) LIKE '%PROGRESS-REPORT%'
    OR upper(filename) LIKE '%CONTENT-EXTRACTION%'
    OR upper(filename) LIKE '%BENCHMARK%'
    OR upper(filename) LIKE '%GAP-ANALYSIS%'
    OR upper(filename) LIKE '%TODO%'
    OR upper(filename) LIKE '%README%'
    OR upper(filename) LIKE '%PRD-%'
    OR upper(filename) LIKE '%PROJECT-STATUS%'
    OR upper(filename) LIKE '%MISSING-ITEMS%'
    OR upper(filename) LIKE '%PRODUCTION-PIPELINE%'
    OR upper(filename) LIKE '%CERTIFICATION-BENCHMARK%'
    OR upper(filename) LIKE '%CLAUDE.MD%'
    OR upper(filename) LIKE '%CHANGELOG%'
    OR upper(filename) LIKE '%PROJECT-PLAN%'
    OR upper(filename) LIKE '%STATUS.MD'
  );

-- Mirror to chunks so RPC can filter without a join
UPDATE mindy_rag_chunks c
SET doc_type = d.doc_type
FROM mindy_rag_documents d
WHERE c.document_id = d.id
  AND d.doc_type = 'meta_doc';

-- ---- (2) Retrieval RPC --------------------------------------------
-- Returns top-N chunks ranked by ts_rank_cd * doc_type_boost.
-- Boost coefficients pick from the "what we actually want to cite"
-- list, with course_material/teaching_handout in the middle:
--   cap_statement, proposal_template, past_performance → 2.0
--   course_material, teaching_handout, webinar_resource → 1.3
--   qa_dataset → 1.2
--   slide_deck → 1.0
--   misc → 0.6
--   meta_doc → 0.2 (effectively excluded)
--
-- Query string is the raw user text — we let to_tsquery_loose handle
-- tokenization (websearch_to_tsquery is more forgiving than the
-- '|'-joined form).

CREATE OR REPLACE FUNCTION get_rag_chunks(
  q text,
  doc_types_filter text[] DEFAULT NULL,
  limit_n int DEFAULT 20
)
RETURNS TABLE (
  document_id uuid,
  chunk_index int,
  chunk_text text,
  doc_title text,
  doc_type text,
  doc_top_level_folder text,
  source_path text,
  rank real
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ts_q tsquery;
BEGIN
  -- websearch_to_tsquery handles common search patterns (quotes, OR,
  -- minus, etc.) and tolerates malformed input without erroring.
  ts_q := websearch_to_tsquery('english', coalesce(q, ''));

  -- If query produced no tokens, return empty
  IF ts_q::text = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.document_id,
    c.chunk_index,
    c.chunk_text,
    c.doc_title,
    c.doc_type,
    c.doc_top_level_folder,
    c.source_path,
    (
      ts_rank_cd(c.fts, ts_q, 32) *
      CASE c.doc_type
        WHEN 'cap_statement'     THEN 2.0::real
        WHEN 'proposal_template' THEN 2.0::real
        WHEN 'past_performance'  THEN 2.0::real
        WHEN 'course_material'   THEN 1.3::real
        WHEN 'teaching_handout'  THEN 1.3::real
        WHEN 'webinar_resource'  THEN 1.3::real
        WHEN 'qa_dataset'        THEN 1.2::real
        WHEN 'slide_deck'        THEN 1.0::real
        WHEN 'ebook'             THEN 1.0::real
        WHEN 'misc'              THEN 0.6::real
        WHEN 'meta_doc'          THEN 0.2::real
        ELSE 0.8::real
      END
    )::real AS rank
  FROM mindy_rag_chunks c
  WHERE c.fts @@ ts_q
    AND (doc_types_filter IS NULL OR c.doc_type = ANY(doc_types_filter))
    AND c.doc_type IS DISTINCT FROM 'meta_doc'  -- always exclude meta-docs from default retrieval
  ORDER BY rank DESC
  LIMIT limit_n;
END;
$$;

COMMENT ON FUNCTION get_rag_chunks(text, text[], int) IS
  'Ranked RAG retrieval over mindy_rag_chunks using ts_rank_cd with doc_type boosts. Used by retrieveRagContext() in src/lib/rag/retrieve.ts to power Mindy Proposal Assist drafts.';

NOTIFY pgrst, 'reload schema';
