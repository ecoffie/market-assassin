-- Podcast transcription resume-state table
--
-- Built 2026-05-27 to drive the Groq Whisper batch transcription of
-- 345 long-form GovCon Giants Podcast episodes (>=15 min, no existing
-- transcript). The batch will take a few hours; a process-resumable
-- table lets us restart safely if anything dies mid-run.
--
-- Lifecycle:
--   pending → in_progress → completed | failed | skipped
--
-- Idempotent: re-running the transcribe script skips rows in 'completed'
-- and retries 'failed' rows (up to attempts < 3).
--
-- After completion, the script replaces mindy_rag_documents.full_text
-- with the transcript content and re-chunks into mindy_rag_chunks.
CREATE TABLE IF NOT EXISTS podcast_transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Episode identity
  source_path TEXT NOT NULL UNIQUE,         -- matches mindy_rag_documents.source_path
  episode_title TEXT NOT NULL,
  episode_url TEXT NOT NULL,                -- libsyn permalink for human reference
  audio_url TEXT NOT NULL,                  -- the .mp3 URL (pre-redirect)
  duration_seconds INT NOT NULL,
  audio_bytes BIGINT,

  -- Transcription state
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,

  -- Output
  transcript_text TEXT,
  transcript_chars INT,
  transcribed_at TIMESTAMPTZ,
  provider TEXT,                            -- 'groq_whisper_v3_turbo'
  provider_cost_usd NUMERIC(10, 5),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_podcast_transcription_status ON podcast_transcription_jobs(status);
CREATE INDEX IF NOT EXISTS idx_podcast_transcription_attempts ON podcast_transcription_jobs(attempts);

COMMENT ON TABLE podcast_transcription_jobs IS
  'Drives the Groq Whisper batch transcription of GovCon Giants Podcast back-catalog (~345 long-form episodes). Resumable: scripts/transcribe-govcon-podcast.js processes rows in pending/failed status, writes transcript_text on success, and the result is folded back into mindy_rag_documents.';

NOTIFY pgrst, 'reload schema';
