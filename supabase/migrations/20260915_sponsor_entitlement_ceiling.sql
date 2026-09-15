-- ============================================================================
-- Sponsor entitlements — CEILING-CLAIM top-up (2026-09-15, same day as
-- 20260915_sponsor_entitlements.sql; that migration already shipped its table).
--
-- THE DEFECT THIS FIXES (measured, not theoretical):
-- The monthly grant claimed one key per account per month (pro:<email>:<YYYY-MM>).
-- That correctly stops a DUPLICATE grant, but it also blocks a LEGITIMATE increase:
--
--   • paid grant of 1,500 lands on the 3rd → key claimed
--   • sponsorship (8,000) resolves later that month → key already claimed
--   → she sits at 1,500, short 6,500 of her actual entitlement, until next month
--
--   • mid-month upgrade 1,500 → 8,000 → same block, granted 0
--
-- "No stacking" means she must never receive 1,500 AND 8,000 (9,500). It does NOT
-- mean she is capped at whatever arrived first. The correct behaviour is the
-- DIFFERENCE: top her up to the highest ceiling she is entitled to this month.
--
-- FIX: the idempotency guard claims a (month, ceiling) pair, not just a month.
-- A re-run at the SAME ceiling is a no-op (duplicate protection intact). A HIGHER
-- ceiling is a new claim that grants only the shortfall to the new ceiling — so
-- total credits for the month equal the highest single entitlement, never the sum.
-- A LOWER ceiling never grants (a smaller paid plan cannot reduce a sponsorship).
--
-- Idempotent DDL; service_role only.
-- ============================================================================

-- The guard row's key now encodes the ceiling, so the caller passes a BASE key and
-- the function derives the claim. Callers keep passing pro:<email>:<YYYY-MM>.
CREATE OR REPLACE FUNCTION mcp_topup_to_ceiling(
  p_key TEXT, p_user TEXT, p_ceiling INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, granted INTEGER, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_current   INTEGER;
  v_short     INTEGER;
  v_balance   INTEGER;
  v_claim_key TEXT;
  v_granted_this_month INTEGER;
BEGIN
  IF p_ceiling <= 0 THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  v_claim_key := p_key || ':c' || p_ceiling::TEXT;

  -- Claim THIS ceiling for the month. A repeat at the same ceiling leaves FOUND=false.
  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (v_claim_key, p_user, 0, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- Lock the balance, then derive the shortfall from the LOCKED value. Computing
  -- this outside the lock is the read-then-write race the whole design avoids.
  SELECT balance INTO v_current FROM mcp_credit_balance
    WHERE user_email = p_user FOR UPDATE;
  v_current := COALESCE(v_current, 0);

  -- NO STACKING, measured against what this month ALREADY granted — not against the
  -- live balance alone. Spending must not re-open a grant: if 8,000 was granted this
  -- month and she spent down to 200, a repeat 8,000 claim must NOT refill her (that
  -- would make the monthly allowance a daily one). So:
  --
  --   granted_this_month = credits already given under any ceiling for this base key
  --   owed               = ceiling - granted_this_month   (the INCREASE she is entitled to)
  --
  -- and we never hand out more than the balance is actually short, so a user sitting
  -- above the ceiling receives nothing.
  SELECT COALESCE(SUM(credits), 0) INTO v_granted_this_month
    FROM mcp_credit_topups
   WHERE user_email = p_user
     AND idempotency_key LIKE p_key || ':c%';

  v_short := LEAST(
    GREATEST(0, p_ceiling - v_granted_this_month),  -- the eligible INCREASE
    GREATEST(0, p_ceiling - v_current)              -- never exceed the actual shortfall
  );

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
