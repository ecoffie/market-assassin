-- ============================================================================
-- Route grants into the right pool, and compute the ceiling from ALLOWANCE (2026-09-15)
--
-- The pool columns shipped with a correct historical backfill but NO write path: every
-- grant still landed as allowance, so a NEW purchase never reached purchased_balance.
-- Measured: buying 1,000 credits produced purchased=0. The split was true only of the past.
--
-- Two fixes, both required for the model to hold:
--   1. mcp_apply_credit routes by REASON — stripe_topup / auto_recharge raise
--      purchased_balance; everything else is allowance. (Subscription-included credits
--      are allowance: paying for a subscription does not buy a refill pack.)
--   2. mcp_topup_to_ceiling measures the ceiling against the ALLOWANCE pool, not the
--      whole balance. Without this the ceiling either absorbs the purchase (original
--      defect) or becomes a flat monthly addition (the over-correction) — measured:
--      allowance reached 9,000 against an 8,000 ceiling.
-- Idempotent; service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_apply_credit(
  p_key TEXT, p_user TEXT, p_credits INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_is_purchase BOOLEAN := p_reason IN ('stripe_topup', 'auto_recharge');
BEGIN
  IF p_credits <= 0 THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (p_key, p_user, p_credits, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- Raising purchased_balance in the SAME statement is what tells the pool guard this
  -- increase is a purchase; the guard leaves a caller-set purchased_balance alone.
  INSERT INTO mcp_credit_balance(user_email, balance, purchased_balance)
  VALUES (p_user, p_credits, CASE WHEN v_is_purchase THEN p_credits ELSE 0 END)
  ON CONFLICT (user_email)
    DO UPDATE SET
      balance = mcp_credit_balance.balance + p_credits,
      purchased_balance = mcp_credit_balance.purchased_balance
                          + CASE WHEN v_is_purchase THEN p_credits ELSE 0 END,
      updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_credits, p_reason, v_balance);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- ---------------------------------------------------------------------------
-- Ceiling measured against ALLOWANCE. Purchased credits neither suppress the refill nor
-- inflate the ceiling; the monthly grant limit and no-stacking guard are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mcp_topup_to_ceiling(
  p_key TEXT, p_user TEXT, p_ceiling INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, granted INTEGER, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance            INTEGER;
  v_purchased          INTEGER;
  v_allowance          INTEGER;
  v_short              INTEGER;
  v_claim_key          TEXT;
  v_granted_this_month INTEGER;
BEGIN
  IF p_ceiling <= 0 THEN
    RETURN QUERY SELECT false, 0, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  v_claim_key := p_key || ':c' || p_ceiling::TEXT;

  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (v_claim_key, p_user, 0, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  SELECT balance, purchased_balance INTO v_balance, v_purchased
    FROM mcp_credit_balance WHERE user_email = p_user FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_purchased := COALESCE(v_purchased, 0);
  v_allowance := GREATEST(0, v_balance - v_purchased);

  SELECT COALESCE(SUM(credits), 0) INTO v_granted_this_month
    FROM mcp_credit_topups
   WHERE user_email = p_user AND idempotency_key LIKE p_key || ':c%';

  -- Top the ALLOWANCE pool up to the ceiling, but never re-grant what this month already
  -- gave (the spend-down guard: a monthly allowance, not a daily refill).
  v_short := LEAST(
    GREATEST(0, p_ceiling - v_granted_this_month),
    GREATEST(0, p_ceiling - v_allowance)
  );

  IF v_short = 0 THEN
    RETURN QUERY SELECT true, 0, v_balance;
    RETURN;
  END IF;

  UPDATE mcp_credit_balance
     SET balance = balance + v_short, updated_at = now()
   WHERE user_email = p_user
  RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    INSERT INTO mcp_credit_balance(user_email, balance, purchased_balance)
    VALUES (p_user, v_short, 0) RETURNING balance INTO v_balance;
  END IF;

  UPDATE mcp_credit_topups SET credits = v_short WHERE idempotency_key = v_claim_key;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, v_short, p_reason, v_balance);

  RETURN QUERY SELECT true, v_short, v_balance;
END $$;

NOTIFY pgrst, 'reload schema';
