-- Proposal Assist template corpus doc types
--
-- Adds explicit format/reference document types for Proposal Assist RAG.
-- These are not "downloads"; they are writing-pattern references the model
-- retrieves per notice type:
--   sources_sought_loi, rfi_response, rfq_response,
--   technical_volume, management_volume, pricing_volume

COMMENT ON COLUMN mindy_rag_documents.doc_type IS
  'Auto-classified document type. Proposal Assist format refs include sources_sought_loi, rfi_response, rfq_response, technical_volume, management_volume, pricing_volume, plus cap_statement, proposal_template, past_performance, teaching_handout, course_material, slide_deck, webinar_resource, planner_app_code, qa_dataset, ebook, misc.';

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
        WHEN 'sources_sought_loi' THEN 2.6::real
        WHEN 'rfi_response'       THEN 2.5::real
        WHEN 'rfq_response'       THEN 2.5::real
        WHEN 'technical_volume'   THEN 2.3::real
        WHEN 'management_volume'  THEN 2.3::real
        WHEN 'pricing_volume'     THEN 2.3::real
        WHEN 'cap_statement'      THEN 2.0::real
        WHEN 'proposal_template'  THEN 2.0::real
        WHEN 'past_performance'   THEN 2.0::real
        WHEN 'course_material'    THEN 1.3::real
        WHEN 'teaching_handout'   THEN 1.3::real
        WHEN 'webinar_resource'   THEN 1.3::real
        WHEN 'qa_dataset'         THEN 1.2::real
        WHEN 'slide_deck'         THEN 1.0::real
        WHEN 'ebook'              THEN 1.0::real
        WHEN 'misc'               THEN 0.6::real
        WHEN 'meta_doc'           THEN 0.2::real
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
  'Ranked RAG retrieval over mindy_rag_chunks using ts_rank_cd with doc_type boosts. Proposal Assist uses format-specific doc_types so LOI/RFI/RFQ/RFP outputs retrieve the right document patterns.';

NOTIFY pgrst, 'reload schema';
