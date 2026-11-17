-- Vault is the ONLY document store (Eric, 2026-11-17).
--
-- Replaces the retired draft docs/held/HELD-20261117_chat_documents.sql (a separate
-- chat_documents table, "never the Vault"). Ask Mindy uploads and generated files
-- are now rows in user_boilerplate_docs, told apart by doc_class.
--
-- ⚠️ NOT APPLIED. Committed for review. Applying it needs Eric's approval of the
-- production migration plan: `npm run migrate` (dry run) → `npm run migrate -- --go`
-- → verify the columns through PostgREST (`npm run db:check -- user_boilerplate_docs doc_class`).
--
-- Additive and idempotent:
--   * every column is NULLABLE with no default, so no existing row is rewritten
--     and no existing insert breaks;
--   * no UPDATE / backfill. A NULL doc_class means 'company' — the reading code
--     (src/lib/vault/doc-class.ts) maps it, so legacy rows need no data change;
--   * constraints are added only if missing.
--
-- Columns:
--   doc_class        'company'   — the user's own company material (cap statement, past perf…);
--                                  the only class the parse → commit flow may turn into Vault facts
--                    'reference' — a file attached in Ask Mindy to ask about (an RFP, a SOW…)
--                    'generated' — a file Mindy rendered (DOCX/PDF from a DocModel)
--   source           'vault' | 'ask_mindy' — which surface created the row
--   chat_session_id  the Ask Mindy conversation it came from; the conversation can be
--                    deleted without deleting the document (ON DELETE SET NULL)
--   notice_id        the SAM notice it concerns, when known (Map drawer)
--   parent_id        previous version (a revision is a NEW row; nothing is overwritten)
--   version          1-based version number within a parent chain
--   doc_model        the DocModel a generated file was rendered from (schema 'mindy.doc/1')
--   source_doc_ids   Vault documents a generated file was built from

ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS doc_class TEXT;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS chat_session_id UUID;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS notice_id TEXT;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS version INT;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS doc_model JSONB;
ALTER TABLE user_boilerplate_docs ADD COLUMN IF NOT EXISTS source_doc_ids UUID[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_boilerplate_docs_doc_class_check') THEN
    ALTER TABLE user_boilerplate_docs ADD CONSTRAINT user_boilerplate_docs_doc_class_check
      CHECK (doc_class IS NULL OR doc_class IN ('company', 'reference', 'generated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_boilerplate_docs_source_check') THEN
    ALTER TABLE user_boilerplate_docs ADD CONSTRAINT user_boilerplate_docs_source_check
      CHECK (source IS NULL OR source IN ('vault', 'ask_mindy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_boilerplate_docs_version_check') THEN
    ALTER TABLE user_boilerplate_docs ADD CONSTRAINT user_boilerplate_docs_version_check
      CHECK (version IS NULL OR version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_boilerplate_docs_chat_session_fk') THEN
    ALTER TABLE user_boilerplate_docs ADD CONSTRAINT user_boilerplate_docs_chat_session_fk
      FOREIGN KEY (chat_session_id) REFERENCES mindy_chat_sessions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_boilerplate_docs_parent_fk') THEN
    ALTER TABLE user_boilerplate_docs ADD CONSTRAINT user_boilerplate_docs_parent_fk
      FOREIGN KEY (parent_id) REFERENCES user_boilerplate_docs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_boilerplate_class
  ON user_boilerplate_docs (user_email, doc_class, archived_at);
CREATE INDEX IF NOT EXISTS idx_boilerplate_session
  ON user_boilerplate_docs (chat_session_id) WHERE chat_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boilerplate_parent
  ON user_boilerplate_docs (parent_id) WHERE parent_id IS NOT NULL;
