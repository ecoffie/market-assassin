-- ============================================================================
-- MCP credit top-ups / idempotent grants  (2026-07-12)  — Slice 4
--
-- Generic EXACTLY-ONCE credit application, keyed by an idempotency string. Used by:
--   * Stripe top-ups        → key = the Stripe checkout session id
--   * Pro monthly allowance → key = 'pro:<email>:<YYYY-MM>'
--
-- Stripe re-delivers webhooks and a monthly cron may re-run, so the guard row makes
-- both paths safe to call repeatedly: the credits land at most once per key.
--
-- Builds on mcp_credit_balance/_ledger (migration 20260712_mcp_credit_ledger.sql).
-- Idempotent DDL; service_role-only. Run AFTER the credit-ledger migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_credit_topups (
  idempotency_key TEXT PRIMARY KEY,          -- stripe session id | 'pro:<email>:<YYYY-MM>'
  user_email      TEXT NOT NULL,
  credits         INTEGER NOT NULL,
  reason          TEXT NOT NULL,             -- 'stripe_topup' | 'pro_monthly' | ...
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_credit_topups_user ON mcp_credit_topups (user_email, created_at DESC);

-- Apply credits AT MOST ONCE for a given key. Inserts the guard row; only if it was
-- newly inserted do we grant (upsert balance + append the ledger row). Returns whether
-- it applied + the resulting balance. One transaction => exactly-once under retries.
CREATE OR REPLACE FUNCTION mcp_apply_credit(
  p_key TEXT, p_user TEXT, p_credits INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_credits <= 0 THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- Guard row. ON CONFLICT DO NOTHING sets FOUND=false when the key already exists,
  -- so a duplicate (Stripe re-delivery / cron re-run) skips the grant below.
  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (p_key, p_user, p_credits, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  INSERT INTO mcp_credit_balance(user_email, balance)
  VALUES (p_user, p_credits)
  ON CONFLICT (user_email)
    DO UPDATE SET balance = mcp_credit_balance.balance + p_credits, updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_credits, p_reason, v_balance);

  RETURN QUERY SELECT true, v_balance;
END $$;

ALTER TABLE mcp_credit_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_credit_topups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_credit_topups_service ON mcp_credit_topups;
CREATE POLICY mcp_credit_topups_service ON mcp_credit_topups FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON mcp_credit_topups FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
