-- Phase 1 (Mindy v2): base-wide capability vectors for semantic hidden-match alerts.
--
-- WHY: the capability vector previously lived ONLY on user_identity_profile (32 rows),
-- but the base-wide NAICS+keyword profile source-of-truth is user_notification_settings
-- (~10,191 rows). So hidden-match fired for ~nobody. Store the fallback vector here so
-- the whole active base can be matched by MEANING. getCapabilityVector() reads this
-- table first, falls back to user_identity_profile.capability_embedding second.
--
-- Column shape mirrors user_identity_profile exactly:
--   capability_embedding         jsonb   -- raw number[] from embedText (JSONB, no pgvector)
--   capability_embed_source_hash text    -- sha1 of the meaning blob; skip re-embed when unchanged
--   capability_embedded_at       timestamptz -- NULL => needs (re)embedding; the cron/backfill drains NULLs
--
-- Idempotent. Hand-run in Supabase (this DB has no in-app DDL).

ALTER TABLE public.user_notification_settings
  ADD COLUMN IF NOT EXISTS capability_embedding jsonb,
  ADD COLUMN IF NOT EXISTS capability_embed_source_hash text,
  ADD COLUMN IF NOT EXISTS capability_embedded_at timestamptz;

-- Partial index so the backfill/cron "rows needing embedding" scan (embedded_at IS NULL)
-- stays fast across 10k+ rows.
CREATE INDEX IF NOT EXISTS idx_uns_capability_embed_pending
  ON public.user_notification_settings (capability_embedded_at)
  WHERE capability_embedded_at IS NULL;
