-- ⚠️ HELD — DO NOT APPLY. Draft only, deliberately kept OUT of supabase/migrations/ so the runner
-- cannot pick it up. Applying it to production needs Eric's approval; when approved, move it to
-- supabase/migrations/<date>_chat_documents.sql and run `npm run migrate` (dry run, then --go), then
-- verify through PostgREST.
--
-- chat_documents — documents that belong to ONE Ask Mindy conversation:
--   origin = 'upload'    a file the user attached in chat (extracted text only; no raw file is kept)
--   origin = 'generated' a DocModel Mindy produced (src/lib/documents/model.ts), one row per version
--
-- Ownership (mirrors the #2089/#2100 acting-scope rules; enforced by the routes, never by the client):
--   owner_email = vaultEmailFor(resolveChatActingScope(caller, request))
--     no workspace header        → the caller's own email
--     authorized coach in client → the client's synthetic workspace email
--     unauthorized header        → ignored → the caller's own email
--     resolver error             → no owner → the upload/generation is REFUSED and nothing is read
--   uploaded_by = the caller (audit only; never used for access)
--   session_id must already belong to the caller (the chat route proves this before use)
--
-- Retention: no new policy. Deleting the conversation (DELETE /api/app/chat-sessions) cascades here,
-- exactly like mindy_chat_messages. A single document can be removed by deleting its row.
--
-- Never the Vault: nothing here writes to user_* Vault tables or the vault-assets bucket.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS chat_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mindy_chat_sessions(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL CHECK (owner_email = lower(owner_email) AND length(owner_email) > 3),
  uploaded_by TEXT NOT NULL CHECK (uploaded_by = lower(uploaded_by) AND length(uploaded_by) > 3),
  origin TEXT NOT NULL CHECK (origin IN ('upload', 'generated')),

  -- Shared metadata
  filename TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- origin = 'upload'
  size_bytes BIGINT,
  page_count INT,
  char_count INT,
  extracted_text TEXT,                 -- capped by the upload route (truncated flag below)
  text_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_status TEXT CHECK (extraction_status IN ('ok', 'empty', 'failed')),

  -- origin = 'generated'
  model JSONB,                         -- DocModel (schema 'mindy.doc/1'), validated before insert
  version INT,
  parent_id UUID REFERENCES chat_documents(id) ON DELETE CASCADE,

  CONSTRAINT chat_documents_upload_shape CHECK (
    origin <> 'upload' OR (model IS NULL AND version IS NULL AND extraction_status IS NOT NULL)
  ),
  CONSTRAINT chat_documents_generated_shape CHECK (
    origin <> 'generated' OR (model IS NOT NULL AND version IS NOT NULL AND version >= 1 AND extracted_text IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_documents_session_owner
  ON chat_documents (session_id, owner_email, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_documents_owner
  ON chat_documents (owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_documents_parent
  ON chat_documents (parent_id) WHERE parent_id IS NOT NULL;

-- Service role only: RLS on, no policies. Every read and write goes through server routes that apply
-- the ownership key above.
ALTER TABLE chat_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE chat_documents IS
  'Ask Mindy conversation documents: user uploads (extracted text only) and generated DocModel versions. Owner = acting-scope email; deleted with the conversation (ON DELETE CASCADE from mindy_chat_sessions).';

NOTIFY pgrst, 'reload schema';
