-- Ask Mindy execution trace (safety release + Phase 0, approved 2026-11-13).
--
-- Ask Mindy (the in-app chat) ran Mindy tools with no record at all: no mcp_call_log row,
-- no arguments, no model, no credit price. These columns let every chat tool execution be
-- traced (channel = 'app_chat') in the SAME call log MCP uses, and give the unified credit
-- accounting observation period its data (catalog price recorded, 0 deducted).
--
-- ADDITIVE ONLY: nullable columns, no defaults, no backfill, no rewrite. MCP rows written by
-- runMeteredTool leave every new column NULL, exactly as before. No CHECK constraints, for the
-- same reason as 20261002_mcp_call_log_outcome / 20261003_mcp_call_log_channel: a best-effort
-- telemetry write must never reject the whole row. logCall retries in the legacy row shape if
-- these columns are absent.
--
-- Access: mcp_call_log and mindy_chat_messages are already RLS-enabled, service-role only.
-- args_redacted holds REDACTED arguments only (src/lib/chat/redact-args.ts, strict allowlist):
-- only validated codes, identifiers, known agency names, dates, numbers, schema enum values and
-- known boolean flags are stored verbatim; every other value is reduced to type + length (+ an
-- optional keyed digest). No tool result bodies are stored here or in mindy_chat_messages.trace.
--
-- Rollback: these columns are read by nothing in MCP; dropping them is safe.

ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS execution_id uuid;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS chat_session_id uuid;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS args_redacted jsonb;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS credit_price integer;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS resource_ids jsonb;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS error_category text;

CREATE INDEX IF NOT EXISTS idx_mcp_call_log_execution_id
  ON public.mcp_call_log (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_call_log_chat_session
  ON public.mcp_call_log (chat_session_id, created_at) WHERE chat_session_id IS NOT NULL;

COMMENT ON COLUMN public.mcp_call_log.execution_id IS
  'One id per tool execution (Ask Mindy). NULL for MCP rows until debit idempotency (Phase 2).';
COMMENT ON COLUMN public.mcp_call_log.chat_session_id IS
  'mindy_chat_sessions.id for an Ask Mindy call; NULL for MCP.';
COMMENT ON COLUMN public.mcp_call_log.model IS 'Planner model that requested the call (Ask Mindy).';
COMMENT ON COLUMN public.mcp_call_log.provider IS 'Planner provider that requested the call (Ask Mindy).';
COMMENT ON COLUMN public.mcp_call_log.args_redacted IS
  'Tool arguments after strict-allowlist redaction: validated codes/ids/agencies/dates/numbers/enums verbatim; everything else type + length (+ keyed digest). Never raw.';
COMMENT ON COLUMN public.mcp_call_log.credit_price IS
  'Catalog credit price of the tool at call time. credits_charged is the actual deduction (0 for app_chat during the observation period).';
COMMENT ON COLUMN public.mcp_call_log.resource_ids IS 'Ids of resources a write created or changed.';
COMMENT ON COLUMN public.mcp_call_log.error_category IS
  'Why a call was refused or failed: blocked_defect | confirmation_required | blocked_chat_exception | round_budget_exceeded | write_budget_exceeded | invalid_arguments | invalid_input | tool_error.';

ALTER TABLE public.mindy_chat_messages ADD COLUMN IF NOT EXISTS trace jsonb;
COMMENT ON COLUMN public.mindy_chat_messages.trace IS
  'Ask Mindy turn trace: planner attempts, answer model, finish_reason, tool execution ids/statuses, notices. No arguments, no result bodies.';
