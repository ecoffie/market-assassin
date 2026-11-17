-- ROLLBACK for supabase/migrations/20261117_vault_doc_class.sql
-- Not a migration: lives outside supabase/migrations so the runner never applies it.
-- Run manually (psql -f, or the SQL editor) ONLY if the forward migration must be reverted.
--
-- One transaction: if any statement fails — including the refusal below — NOTHING is dropped and
-- the ledger row stays. (Without BEGIN/COMMIT, psql would carry on past a refusal and drop anyway.)
--
-- REFUSES while any row is classified 'reference' or 'generated'. Dropping doc_class would silently
-- turn those rows into the user's own COMPANY material (a NULL doc_class reads as 'company' in
-- src/lib/vault/doc-class.ts), and company documents are the only class the parse → commit flow may
-- turn into Vault facts — an attached RFP or a Mindy-generated report would become "your company".
-- Deal with those rows first (decide with Eric: archive, delete, or export), then re-run.
-- Rows with doc_class 'company' or NULL lose nothing by the rollback.
--
-- Data lost on rollback (by design, for the rows that remain): source, chat_session_id, notice_id,
-- parent_id/version chains, doc_model, source_doc_ids. The 17 original columns and their data are
-- untouched. Storage objects in vault-assets are not touched.
--
-- Afterwards the ledger row is gone, so `npm run migrate` sees the migration as pending again.

BEGIN;

DO $$
DECLARE
  classified bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_boilerplate_docs' AND column_name = 'doc_class'
  ) THEN
    EXECUTE $q$SELECT count(*) FROM public.user_boilerplate_docs WHERE doc_class IN ('reference', 'generated')$q$
      INTO classified;
    IF classified > 0 THEN
      RAISE EXCEPTION 'rollback refused: % user_boilerplate_docs row(s) have doc_class reference/generated and would be silently reclassified as company documents', classified
        USING HINT = 'Archive, delete or export those rows first (Eric decides), then re-run this rollback.';
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_boilerplate_parent_version;
DROP INDEX IF EXISTS public.idx_boilerplate_session;
DROP INDEX IF EXISTS public.idx_boilerplate_class;

ALTER TABLE public.user_boilerplate_docs DROP CONSTRAINT IF EXISTS user_boilerplate_docs_parent_fk;
ALTER TABLE public.user_boilerplate_docs DROP CONSTRAINT IF EXISTS user_boilerplate_docs_chat_session_fk;
ALTER TABLE public.user_boilerplate_docs DROP CONSTRAINT IF EXISTS user_boilerplate_docs_version_check;
ALTER TABLE public.user_boilerplate_docs DROP CONSTRAINT IF EXISTS user_boilerplate_docs_source_check;
ALTER TABLE public.user_boilerplate_docs DROP CONSTRAINT IF EXISTS user_boilerplate_docs_doc_class_check;

ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS source_doc_ids;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS doc_model;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS version;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS parent_id;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS notice_id;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS chat_session_id;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS source;
ALTER TABLE public.user_boilerplate_docs DROP COLUMN IF EXISTS doc_class;

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '20261117_vault_doc_class.sql';
  END IF;
END $$;

COMMIT;
