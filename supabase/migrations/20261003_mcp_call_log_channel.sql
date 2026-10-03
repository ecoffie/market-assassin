-- MCP call log: which surface a call arrived on (ChatGPT developer-mode acceptance, 2026-10-03).
--
-- mcp_credit_ledger.channel (20261003_mcp_autorecharge_chatgpt_attribution.sql) marks a
-- ChatGPT DEBIT, but a call that is refused, blocked, free or uncharged has no ledger row,
-- and the call log (latency, outcome) had no channel at all: a ChatGPT call could only be
-- found by joining its ledger row on timestamp. This lets ChatGPT calls be measured directly.
--
-- ADDITIVE ONLY: one nullable column, no default, no backfill, no index. Only the
-- /chatgpt/mcp handler writes it ('chatgpt'); the Claude/general edge writes nothing, so
-- its rows stay NULL, and every row written before this migration stays NULL.
--
-- No CHECK constraint, deliberately (same reason as the outcome columns): a best-effort
-- telemetry write must never reject the whole row. The value is pinned by the TypeScript
-- type MeteredContext.channel ('chatgpt') and log-call.unit.test.ts.
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS channel text;

COMMENT ON COLUMN public.mcp_call_log.channel IS
  'MCP surface the call arrived on: ''chatgpt'' = /chatgpt/mcp. NULL = Claude/general edge, or written before 2026-10-03.';
