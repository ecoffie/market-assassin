-- ============================================================================
-- Sponsored ceiling must NOT absorb PURCHASED credits (2026-09-15)
--
-- THE DEFECT (measured, before this migration): a sponsored user with an 8,000 monthly
-- ceiling who BUYS a 1,000-credit top-up ends the renewal at 8,000 — not 9,000. The
-- purchase is swallowed by the allowance. They paid $119 and received nothing.
--
--   bought 1,000        → balance 1,000
--   sponsored top-up    → grants only 7,000 (because 8,000 - 1,000 = 7,000)
--   final balance       → 8,000   ← the $119 bought no additional credits
--
-- CAUSE: the shortfall was `LEAST(ceiling - granted_this_month, ceiling - balance)`.
-- The second term measures the allowance against the WHOLE balance, which includes money
-- the user spent. An entitlement is a floor the SPONSOR funds; it must be computed from
-- what the SPONSORSHIP has granted, never from credits the customer bought.
--
-- FIX: measure the shortfall against sponsor-granted credits only. Purchased credits sit
-- ON TOP of the allowance, which is what "non-expiring and preserved through renewal"
-- has to mean for a paid top-up to be worth buying at all.
--
-- The spend-down guard is UNCHANGED and still load-bearing: `ceiling - granted_this_month`
-- means a user who burns the allowance mid-month is not refilled, so this stays a monthly
-- allowance rather than becoming a daily one.
-- Idempotent; service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_topup_to_ceiling(
  p_key TEXT, p_user TEXT, p_ceiling INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, granted INTEGER, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_current            INTEGER;
  v_short              INTEGER;
  v_balance            INTEGER;
  v_claim_key          TEXT;
  v_granted_this_month INTEGER;
BEGIN
  IF p_ceiling <= 0 THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  v_claim_key := p_key || ':c' || p_ceiling::TEXT;

  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (v_claim_key, p_user, 0, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  SELECT balance INTO v_current FROM mcp_credit_balance
    WHERE user_email = p_user FOR UPDATE;
  v_current := COALESCE(v_current, 0);

  -- What the SPONSORSHIP has already granted this month under any ceiling for this key.
  SELECT COALESCE(SUM(credits), 0) INTO v_granted_this_month
    FROM mcp_credit_topups
   WHERE user_email = p_user
     AND idempotency_key LIKE p_key || ':c%';

  -- The eligible increase, measured ONLY against sponsor-granted credits. Purchased
  -- credits are deliberately NOT subtracted — they are the customer's, bought on top.
  v_short := GREATEST(0, p_ceiling - v_granted_this_month);

  IF v_short = 0 THEN
    RETURN QUERY SELECT true, 0, v_current;
    RETURN;
  END IF;

  INSERT INTO mcp_credit_balance(user_email, balance)
  VALUES (p_user, v_short)
  ON CONFLICT (user_email)
    DO UPDATE SET balance = mcp_credit_balance.balance + v_short, updated_at = now()
  RETURNING balance INTO v_balance;

  UPDATE mcp_credit_topups SET credits = v_short WHERE idempotency_key = v_claim_key;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, v_short, p_reason, v_balance);

  RETURN QUERY SELECT true, v_short, v_balance;
END $$;

NOTIFY pgrst, 'reload schema';
