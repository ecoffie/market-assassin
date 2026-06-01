-- Explicit source guard for the notice_id dedup (2026-06-01).
--
-- fetchPursuitDocs reuses extracted docs from ANY pursuit with the same
-- notice_id (scalability — fetch a public SAM attachment once, share it
-- with every user who saves that notice). That reuse is SAFE only
-- because pursuit_documents currently holds nothing but public SAM
-- files. But that invariant was incidental, not enforced — if a future
-- feature ever wrote user-uploaded or user-edited text into this table,
-- dedup would silently copy one user's private content into another
-- user's pursuit.
--
-- This column makes the invariant explicit: dedup ONLY copies rows
-- marked 'sam_public'. Any future user-private row must be written with
-- a different doc_source (e.g. 'user_upload') and can never be deduped.

ALTER TABLE pursuit_documents
  ADD COLUMN IF NOT EXISTS doc_source TEXT NOT NULL DEFAULT 'sam_public';

COMMENT ON COLUMN pursuit_documents.doc_source IS
  'Provenance of this row. ''sam_public'' = a public SAM.gov attachment (safe to dedup/share across users by notice_id). Any user-uploaded or user-edited content MUST use a different value (e.g. ''user_upload'') so the notice_id dedup never copies private text across users.';

-- Backfill: every existing row IS a public SAM file (the upload route
-- never wrote here), so the 'sam_public' default is correct. No data
-- migration needed beyond the default.

NOTIFY pgrst, 'reload schema';
