-- ============================================================================
-- MCP credit ledger  (2026-07-12)  — Mindy MCP Server, Phase 1 Slice 3 (money)
--
-- Prepaid credits that meter MCP tool calls. Three tables + two atomic functions.
--
--   mcp_credit_balance  — SOURCE OF TRUTH for O(1) reads + the atomic debit target.
--                         One row per user. CHECK (balance >= 0) is a hard backstop.
--   mcp_credit_ledger   — append-only audit of every credit movement (+grant/-debit).
--   mcp_call_log        — every tool call (success/failed/rejected/uncharged) for
--                         audit, analytics, and abuse detection.
--
-- ATOMICITY (the load acceptance gate — 100 concurrent calls must not corrupt the
-- balance): debit/grant are Postgres FUNCTIONS so each is ONE row-locked transaction.
-- The `UPDATE ... WHERE balance >= amount RETURNING` in mcp_debit_credits IS the gate:
-- concurrent debits serialize on the row; an insufficient balance simply matches no
-- row (ok=false). App code never does read-then-write, so there is no lost-update race.
--
-- RLS backstop: service_role only (app path); deny anon/authenticated. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_credit_balance (
  user_email  TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    TEXT NOT NULL,
  delta         INTEGER NOT NULL,             -- + grant / top-up, - debit
  reason        TEXT NOT NULL,                -- 'signup_grant' | 'tool_call' | 'stripe_topup' | 'admin_grant' | ...
  tool_name     TEXT,
  api_key_id    UUID,
  balance_after INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_credit_ledger_user ON mcp_credit_ledger (user_email, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_call_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email     TEXT NOT NULL,
  api_key_id     UUID,
  tool_name      TEXT NOT NULL,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,               -- 'success' | 'failed' | 'rejected_no_credits' | 'uncharged'
  latency_ms     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_call_log_user ON mcp_call_log (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_call_log_tool ON mcp_call_log (tool_name, created_at DESC);

-- ---- Atomic debit: decrement iff sufficient, then append the audit row. ----
CREATE OR REPLACE FUNCTION mcp_debit_credits(
  p_user TEXT, p_amount INTEGER, p_reason TEXT, p_tool TEXT, p_api_key_id UUID
) RETURNS TABLE(ok BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    -- Nothing to charge (free tool): report current balance, no ledger row.
    RETURN QUERY SELECT true, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  UPDATE mcp_credit_balance
     SET balance = balance - p_amount, updated_at = now()
   WHERE user_email = p_user AND balance >= p_amount
   RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, tool_name, api_key_id, balance_after)
  VALUES (p_user, -p_amount, p_reason, p_tool, p_api_key_id, v_balance);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- ---- Atomic grant: upsert +amount, then append the audit row. ----
CREATE OR REPLACE FUNCTION mcp_grant_credits(
  p_user TEXT, p_amount INTEGER, p_reason TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RETURN COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
  END IF;

  INSERT INTO mcp_credit_balance(user_email, balance)
  VALUES (p_user, p_amount)
  ON CONFLICT (user_email)
    DO UPDATE SET balance = mcp_credit_balance.balance + p_amount, updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_amount, p_reason, v_balance);

  RETURN v_balance;
END $$;

-- ---- RLS backstop ----
ALTER TABLE mcp_credit_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_credit_balance FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_credit_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_credit_ledger  FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_call_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_call_log       FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_credit_balance_service ON mcp_credit_balance;
CREATE POLICY mcp_credit_balance_service ON mcp_credit_balance FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS mcp_credit_ledger_service ON mcp_credit_ledger;
CREATE POLICY mcp_credit_ledger_service ON mcp_credit_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS mcp_call_log_service ON mcp_call_log;
CREATE POLICY mcp_call_log_service ON mcp_call_log FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON mcp_credit_balance, mcp_credit_ledger, mcp_call_log FROM anon, authenticated, PUBLIC;
