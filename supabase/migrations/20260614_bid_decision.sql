-- Record the bid / no-bid decision on the pursuit.
--
-- Today the BidDecisionGate just opens the next step (onProceed) — the decision
-- (pursue / watch / skip + the fit score) is never saved, so a "no-bid" leaves
-- no trace and the team can't see what was decided. These columns persist it on
-- user_pipeline so it survives + is workspace-visible (same row the team sees).
--
-- No in-app DDL on this DB — run by hand in Supabase.

ALTER TABLE user_pipeline
  ADD COLUMN IF NOT EXISTS bid_decision TEXT,         -- 'pursue' | 'watch' | 'skip'
  ADD COLUMN IF NOT EXISTS bid_score INT,             -- 0-100 fit score from the scorecard
  ADD COLUMN IF NOT EXISTS bid_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bid_decided_by TEXT;       -- who recorded it
