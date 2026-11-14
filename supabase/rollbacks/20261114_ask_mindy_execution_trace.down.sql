-- ROLLBACK for supabase/migrations/20261114_ask_mindy_execution_trace.sql
-- Not a migration: lives outside supabase/migrations so the runner never applies it.
-- Run manually (psql or the SQL editor) ONLY if the forward migration must be reverted, then
-- remove the ledger row so the runner sees the migration as pending again:
--   DELETE FROM schema_migrations WHERE version = '20261114_ask_mindy_execution_trace.sql';
-- Safe: nothing in MCP reads these columns; Ask Mindy's logCall/persistExchange fall back to the
-- pre-migration row shape automatically. Data in the dropped columns (redacted args, traces) is lost.

DROP INDEX IF EXISTS public.idx_mcp_call_log_execution_id;
DROP INDEX IF EXISTS public.idx_mcp_call_log_chat_session;

ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS execution_id;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS chat_session_id;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS model;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS provider;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS args_redacted;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS credit_price;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS resource_ids;
ALTER TABLE public.mcp_call_log DROP COLUMN IF EXISTS error_category;

ALTER TABLE public.mindy_chat_messages DROP COLUMN IF EXISTS trace;
