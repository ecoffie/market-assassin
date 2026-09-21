-- Capability embeddings (Phase 3 — semantic "hidden match" alerts).
-- Caches a per-user capability vector (OpenAI text-embedding-3-small, 1536 dims)
-- so daily alerts can cosine-match the user's capabilities/past-performance against
-- the SOW corpus WITHOUT embedding 1,300+ users per send. Refreshed only when the
-- profile changes (embedded_at set NULL by the write routes; a backfill cron drains).
-- Hand-run in Supabase SQL editor (idempotent). Mirrors 20260611_sow_embeddings.

ALTER TABLE user_identity_profile
  ADD COLUMN IF NOT EXISTS capability_embedding      JSONB,
  ADD COLUMN IF NOT EXISTS capability_embedded_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capability_embed_source_hash TEXT;

-- Partial index so the backfill cron finds rows that need (re)embedding fast.
CREATE INDEX IF NOT EXISTS idx_uip_capability_embed_todo
  ON user_identity_profile (capability_embedded_at NULLS FIRST)
  WHERE capability_embedded_at IS NULL;
