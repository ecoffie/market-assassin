-- Add vault_doc doc_type to RAG retrieval ranking (V2 flagship, Phase 1).
--
-- Context: ingesting the GOVCON EDU "The Vault" Google Drive document library
-- (Teaming/Subcontracting, Target Market List, Scripts, SB Certification, SAM Bid
-- Sites, Proposal Writing, JV Docs, IDVs, FAR, Estimating, …) as doc_type
-- 'vault_doc' (scripts/ingest-vault-docs.js). These are curated teaching/template
-- guides → rank at the teaching grade (1.3), alongside course_material /
-- teaching_handout, NOT above the proven cap_statement / proposal_template (2.0).
--
-- CREATE OR REPLACE of get_rag_chunks() — identical to
-- 20260603_rag_coaching_call_doctype.sql except the one new WHEN branch.
-- retrieve.ts is unchanged. Until this runs, vault_doc falls to the 0.8 ELSE
-- branch (still retrievable, just not yet boosted).
--
-- HAND-RUN in the Supabase SQL editor (this DB has no in-app DDL).

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
        WHEN 'vault_doc'         THEN 1.3::real  -- GOVCON EDU Vault: teaching/template guides
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
  'Ranked RAG retrieval over mindy_rag_chunks using ts_rank_cd with doc_type boosts (incl. coaching_call=2.0, vault_doc=1.3, sales_call=1.1). Used by retrieveRagContext() in src/lib/rag/retrieve.ts.';

NOTIFY pgrst, 'reload schema';
