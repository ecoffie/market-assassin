-- Mindy Chat v1 — RAG-backed Q&A surface
--
-- Built 2026-05-27. Powers the new /app chat panel. Two tables:
--   mindy_chat_sessions — one row per conversation thread
--   mindy_chat_messages — one row per user/assistant message
--
-- v1 is single-session UI (each visit starts fresh), but every
-- message is still persisted so v1.1 can add resumable history
-- without a schema migration.
--
-- Design notes:
-- - user_email keys sessions instead of a user_id FK because all
--   other /app tables key on email and we follow that convention.
-- - cited_sources is JSONB so we can store {title, url, doc_type}
--   per chunk without joining back to mindy_rag_chunks on read.
-- - tokens_used + latency_ms are populated by the endpoint for
--   internal cost-tracking and quality-debugging only — not shown
--   in the UI in v1.

CREATE TABLE IF NOT EXISTS mindy_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Auto-generated from the first user message (truncated at ~60 chars).
  -- Lets a future history sidebar show "What's the difference between
  -- 8(a) and HUBZone?" instead of an opaque UUID.
  title TEXT,

  -- Denormalized so the history sidebar doesn't have to COUNT() messages
  -- per session. Updated by the endpoint after each insert.
  message_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mindy_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mindy_chat_sessions(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,

  -- Sources cited inline by Mindy in this assistant message. Empty []
  -- for user messages. Shape: [{title, url, doc_type, source_path}, ...]
  cited_sources JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Cost + perf debugging (not user-visible in v1)
  tokens_used INT,
  latency_ms INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The two access patterns:
--   1. List a user's recent sessions for history sidebar (v1.1)
--   2. Load all messages for a given session in order
CREATE INDEX IF NOT EXISTS idx_chat_sessions_email_recent
  ON mindy_chat_sessions(user_email, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON mindy_chat_messages(session_id, created_at);

COMMENT ON TABLE mindy_chat_sessions IS
  'Mindy Chat v1 — one row per conversation thread. message_count is denormalized so history sidebar (v1.1) avoids COUNT() queries.';

COMMENT ON TABLE mindy_chat_messages IS
  'Mindy Chat v1 — per-message log. cited_sources holds the inline citations Mindy emitted. tokens_used + latency_ms power internal cost/perf monitoring, not shown in UI.';

NOTIFY pgrst, 'reload schema';
