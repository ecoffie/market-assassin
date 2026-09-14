-- ============================================================================
-- Account-scoped MCP credits (2026-09-14) — identity-model P1 hot path
--
-- Adds nullable account_id (= auth.users.id / user_profiles.user_id) to MCP
-- money tables and an exactly-once apply RPC that accepts MULTIPLE idempotency
-- keys in one transaction. Callers pass (same p_keys array):
--   pro:acct:<uuid>:<YYYY-MM>     -- survives email change (canonical)
--   pro:<email>:<YYYY-MM>…        -- legacy keys so pre-rename grants still block
--
-- COMMENT: monthly key format is now `pro:acct:<uuid>:<YYYY-MM>`; callers MAY
-- also pass legacy `pro:<email>:<YYYY-MM>` keys in the same p_keys array for
-- cross-email idempotency. Do NOT add customer-specific billing remaps.
--
-- Balances remain addressable by user_email during dual-write; account_id is
-- stamped and preferred for lookups. Idempotent DDL. Service-role only.
-- ============================================================================

ALTER TABLE mcp_credit_balance
  ADD COLUMN IF NOT EXISTS account_id UUID;

ALTER TABLE mcp_credit_ledger
  ADD COLUMN IF NOT EXISTS account_id UUID;

ALTER TABLE mcp_credit_topups
  ADD COLUMN IF NOT EXISTS account_id UUID;

ALTER TABLE mcp_api_keys
  ADD COLUMN IF NOT EXISTS account_id UUID;

ALTER TABLE mcp_call_log
  ADD COLUMN IF NOT EXISTS account_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mcp_autorecharge'
  ) THEN
    ALTER TABLE mcp_autorecharge ADD COLUMN IF NOT EXISTS account_id UUID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_credit_balance_account_id
  ON mcp_credit_balance (account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_credit_ledger_account
  ON mcp_credit_ledger (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_credit_topups_account
  ON mcp_credit_topups (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN mcp_credit_balance.account_id IS
  'auth.users.id — stable owner. Email is denormalized display/delivery only. Monthly idempotency key: pro:acct:<uuid>:<YYYY-MM> (+ optional legacy pro:<email>:<YYYY-MM> in same p_keys).';

-- Exactly-once grant across a SET of keys (account + legacy email keys).
-- If ANY key already exists → applied=false + current balance (prefer account_id).
-- Else insert ALL keys and grant once onto the account's balance row
-- (prefer existing account_id row; else email row; else insert).
CREATE OR REPLACE FUNCTION mcp_apply_credit_account(
  p_keys TEXT[],
  p_account_id UUID,
  p_user_email TEXT,
  p_credits INTEGER,
  p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_email TEXT := lower(trim(p_user_email));
  v_existing INT;
BEGIN
  IF p_credits <= 0 OR p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN
    RETURN QUERY SELECT false,
      COALESCE(
        (SELECT balance FROM mcp_credit_balance WHERE account_id = p_account_id LIMIT 1),
        (SELECT balance FROM mcp_credit_balance WHERE user_email = v_email LIMIT 1),
        0
      );
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing
  FROM mcp_credit_topups
  WHERE idempotency_key = ANY (p_keys);

  IF v_existing > 0 THEN
    RETURN QUERY SELECT false,
      COALESCE(
        (SELECT balance FROM mcp_credit_balance WHERE account_id = p_account_id LIMIT 1),
        (SELECT balance FROM mcp_credit_balance WHERE user_email = v_email LIMIT 1),
        0
      );
    RETURN;
  END IF;

  -- No ON CONFLICT swallow: a concurrent race raises unique_violation and rolls
  -- back the whole function so we never grant without a full key set.
  INSERT INTO mcp_credit_topups (idempotency_key, user_email, credits, reason, account_id)
  SELECT k, v_email, p_credits, p_reason, p_account_id
  FROM unnest(p_keys) AS k;

  -- Prefer an existing balance row for this account_id (consolidation / email-change safe).
  -- Do NOT rewrite user_email here when it already differs — PK collision risk if another
  -- row holds p_user_email. Change-email denorm updates happen in app code by account_id.
  UPDATE mcp_credit_balance
     SET balance = balance + p_credits,
         updated_at = now()
   WHERE account_id = p_account_id
   RETURNING balance INTO v_balance;

  IF FOUND THEN
    INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, account_id)
    VALUES (v_email, p_credits, p_reason, v_balance, p_account_id);
    RETURN QUERY SELECT true, v_balance;
    RETURN;
  END IF;

  -- Else upsert by email and stamp account_id (only if null — never steal another account's row).
  INSERT INTO mcp_credit_balance(user_email, balance, account_id)
  VALUES (v_email, p_credits, p_account_id)
  ON CONFLICT (user_email)
    DO UPDATE SET
      balance = mcp_credit_balance.balance + p_credits,
      updated_at = now(),
      account_id = COALESCE(mcp_credit_balance.account_id, EXCLUDED.account_id)
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, account_id)
  VALUES (v_email, p_credits, p_reason, v_balance, p_account_id);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- Account-aware debit: prefer account_id row, else email (legacy dual-write).
CREATE OR REPLACE FUNCTION mcp_debit_credits_account(
  p_account_id UUID,
  p_user TEXT,
  p_amount INTEGER,
  p_reason TEXT,
  p_tool TEXT,
  p_api_key_id UUID
) RETURNS TABLE(ok BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_email TEXT := lower(trim(p_user));
  v_row_email TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT true,
      COALESCE(
        (SELECT balance FROM mcp_credit_balance WHERE account_id = p_account_id LIMIT 1),
        (SELECT balance FROM mcp_credit_balance WHERE user_email = v_email LIMIT 1),
        0
      );
    RETURN;
  END IF;

  UPDATE mcp_credit_balance
     SET balance = balance - p_amount, updated_at = now()
   WHERE account_id = p_account_id AND balance >= p_amount
   RETURNING balance, user_email INTO v_balance, v_row_email;

  IF NOT FOUND THEN
    UPDATE mcp_credit_balance
       SET balance = balance - p_amount, updated_at = now(),
           account_id = COALESCE(account_id, p_account_id)
     WHERE user_email = v_email AND balance >= p_amount
       AND (account_id IS NULL OR account_id = p_account_id)
     RETURNING balance, user_email INTO v_balance, v_row_email;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false,
      COALESCE(
        (SELECT balance FROM mcp_credit_balance WHERE account_id = p_account_id LIMIT 1),
        (SELECT balance FROM mcp_credit_balance WHERE user_email = v_email LIMIT 1),
        0
      );
    RETURN;
  END IF;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, tool_name, api_key_id, balance_after, account_id)
  VALUES (COALESCE(v_row_email, v_email), -p_amount, p_reason, p_tool, p_api_key_id, v_balance, p_account_id);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- Account-aware grant: prefer account_id row, else email upsert + stamp.
CREATE OR REPLACE FUNCTION mcp_grant_credits_account(
  p_account_id UUID,
  p_user TEXT,
  p_amount INTEGER,
  p_reason TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_email TEXT := lower(trim(p_user));
BEGIN
  IF p_amount <= 0 THEN
    RETURN COALESCE(
      (SELECT balance FROM mcp_credit_balance WHERE account_id = p_account_id LIMIT 1),
      (SELECT balance FROM mcp_credit_balance WHERE user_email = v_email LIMIT 1),
      0
    );
  END IF;

  UPDATE mcp_credit_balance
     SET balance = balance + p_amount, updated_at = now()
   WHERE account_id = p_account_id
   RETURNING balance INTO v_balance;

  IF FOUND THEN
    INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, account_id)
    VALUES (v_email, p_amount, p_reason, v_balance, p_account_id);
    RETURN v_balance;
  END IF;

  INSERT INTO mcp_credit_balance(user_email, balance, account_id)
  VALUES (v_email, p_amount, p_account_id)
  ON CONFLICT (user_email)
    DO UPDATE SET
      balance = mcp_credit_balance.balance + p_amount,
      updated_at = now(),
      account_id = COALESCE(mcp_credit_balance.account_id, EXCLUDED.account_id)
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, account_id)
  VALUES (v_email, p_amount, p_reason, v_balance, p_account_id);

  RETURN v_balance;
END $$;

REVOKE ALL ON FUNCTION mcp_apply_credit_account(TEXT[], UUID, TEXT, INTEGER, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_apply_credit_account(TEXT[], UUID, TEXT, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION mcp_debit_credits_account(UUID, TEXT, INTEGER, TEXT, TEXT, UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_debit_credits_account(UUID, TEXT, INTEGER, TEXT, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION mcp_grant_credits_account(UUID, TEXT, INTEGER, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_grant_credits_account(UUID, TEXT, INTEGER, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
