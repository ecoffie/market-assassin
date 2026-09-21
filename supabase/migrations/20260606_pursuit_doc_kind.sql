-- Doc classification for the extraction foundation (PRD-proposal-extraction-
-- compliance). Stores the classified KIND of each pursuit attachment so Proposal
-- Assist can separate + route the right file to the right person (SOW to subs,
-- wage det to estimators, etc.) on a 10-attachment combined synopsis.
--
-- Hand-run in the Supabase SQL editor, then NOTIFY pgrst.

ALTER TABLE pursuit_documents
  ADD COLUMN IF NOT EXISTS doc_kind TEXT,            -- sow_pws | pricing | wage_det | qa | amendment | instructions | eval_factors | solicitation | past_perf_form | rep_certs | attachment_other
  ADD COLUMN IF NOT EXISTS doc_kind_confidence TEXT; -- high | medium | low

CREATE INDEX IF NOT EXISTS idx_pursuit_documents_kind
  ON pursuit_documents (pipeline_id, doc_kind);

NOTIFY pgrst, 'reload schema';
