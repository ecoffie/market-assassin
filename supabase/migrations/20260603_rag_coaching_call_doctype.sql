-- Add coaching_call + sales_call doc_types to RAG retrieval ranking.
--
-- Context: ingesting 430 Fireflies call transcripts + the "Assessment Call
-- Transcripts" doc as proprietary first-party data (branch
-- feat/rag-coaching-calls-ingest). Two new doc_types:
--   coaching_call — assessment / consultancy / Eric 1-on-1 / coaching sessions
--                   → high value, rank alongside cap_statement/past_performance
--   sales_call    — discovery / opportunity / sales meetings (reps pitching)
--                   → useful (objection handling, prospect pain) but lower
--                     boost so it doesn't outrank teaching content in answers
--
-- This is a CREATE OR REPLACE of get_rag_chunks() — identical to
-- 20260526_rag_retrieve_rpc.sql except the two new WHEN branches in the boost
-- CASE. retrieve.ts is unchanged.

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
  ts_q := websearch_to_tsquery('english', coalesce(q, ''));

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
        WHEN 'coaching_call'     THEN 2.0::real  -- proprietary 1st-party coaching
        WHEN 'course_material'   THEN 1.3::real
        WHEN 'teaching_handout'  THEN 1.3::real
        WHEN 'webinar_resource'  THEN 1.3::real
        WHEN 'qa_dataset'        THEN 1.2::real
        WHEN 'sales_call'        THEN 1.1::real  -- objection/pricing/pain; below teaching
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
    AND c.doc_type IS DISTINCT FROM 'meta_doc'
  ORDER BY rank DESC
  LIMIT limit_n;
END;
$$;

COMMENT ON FUNCTION get_rag_chunks(text, text[], int) IS
  'Ranked RAG retrieval over mindy_rag_chunks using ts_rank_cd with doc_type boosts (incl. coaching_call=2.0, sales_call=1.1). Used by retrieveRagContext() in src/lib/rag/retrieve.ts.';

NOTIFY pgrst, 'reload schema';
