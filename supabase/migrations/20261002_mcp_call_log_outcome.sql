-- MCP call OUTCOME telemetry (tool portfolio audit Phase 0, 2026-10-02).
--
-- mcp_call_log.status answers a BILLING question (was it charged?). Across 9,289 calls it
-- never recorded 'failed', because tools catch their own errors, so status='success'
-- only ever meant "did not throw". These columns record what the call actually produced,
-- read from structured fields the tool emits (src/lib/mcp/call-outcome.ts).
--
-- ADDITIVE ONLY: nullable columns, no rewrite, no backfill. Rows written before this
-- migration keep outcome = NULL (meaning "not measured", which is the truth for them).
--
-- No CHECK constraint on outcome/billing_outcome, deliberately: this is a best-effort
-- telemetry write, and a constraint violation would reject the WHOLE row and lose the
-- call itself. The allowed values are enforced by the TypeScript types (CallOutcome,
-- BillingOutcome) and pinned by call-outcome.unit.test.ts.

ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS grounded boolean;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS degraded boolean;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS billing_outcome text;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS error_code text;

COMMENT ON COLUMN public.mcp_call_log.outcome IS
  'What the call produced: grounded | no_result | degraded | refused | error | blocked | unclassified. NULL = written before 2026-10-02 (not measured). See src/lib/mcp/call-outcome.ts.';
COMMENT ON COLUMN public.mcp_call_log.grounded IS
  'Tool-reported _meta.grounded; NULL when the tool does not report it.';
COMMENT ON COLUMN public.mcp_call_log.degraded IS
  'Tool-reported _meta.degraded; NULL when the tool does not report it.';
COMMENT ON COLUMN public.mcp_call_log.billing_outcome IS
  'credit-integrity.ts BillingOutcome for a call that ran; NULL when it never ran.';
COMMENT ON COLUMN public.mcp_call_log.error_code IS
  'Short machine code (e.g. insufficient_credits, keyword_required, tool_exception). Never free text or user input.';

-- Per-tool quality queries filter on (tool_name, created_at) — already indexed by
-- idx_mcp_call_log_tool. Outcome is a low-cardinality column read within that range,
-- so no new index.
