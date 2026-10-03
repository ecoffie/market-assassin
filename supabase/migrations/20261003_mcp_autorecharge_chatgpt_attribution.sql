-- ============================================================================
-- ChatGPT-attributed auto-recharge suppression  (2026-10-03)
--
-- OWNER-APPROVED INVARIANT (frozen; window definition per owner decision 2026-10-03):
--   The attribution window = ChatGPT-attributed consumption since the most recent
--   INDEPENDENT FUNDING EVENT. Between funding events, an automatic payment is permitted
--   only if the account would still qualify after removing all ChatGPT-originated
--   consumption in the current window.
--
-- WHY: the /chatgpt/mcp surface (PR #1776) bills the SAME personal balance as Claude.
-- Without this, ChatGPT usage could drain a balance under the user's threshold and the
-- hourly cron (/api/cron/mcp-autorecharge) would charge their saved card for it — a card
-- payment caused by a surface that is never allowed to sell or upsell.
--
-- MODEL:
--   S = mcp_credit_balance.chatgpt_spend_since_recharge (the current window's ChatGPT spend)
--     · a ChatGPT PERSONAL debit of a → S += a   (same guarded statement as the debit)
--     · any other debit               → S unchanged (normal debits never reduce S)
--     · pool debits/grants            → never touch mcp_credit_balance, so never S
--     · a RESET-ELIGIBLE grant applied to the personal balance → S := 0 (same statement
--       as the grant). Eligibility is the ONE allowlist in
--       mcp_grant_resets_chatgpt_window(); any reason not listed (incl. a brand-new one)
--       does NOT reset.
--   Eligibility, with T = the CURRENT threshold_credits (mcp_recharge_gate):
--       balance >= T                      → 'sufficient'
--       balance <  T AND balance + S >= T → 'chatgpt_caused'
--       balance <  T AND balance + S <  T → eligible
--
-- A declined/failed PaymentIntent never reaches a grant, so it resets nothing. Grants are
-- exactly-once per idempotency key (PaymentIntent / session / invoice / month key), so a
-- double delivery resets once (the second call returns before touching the balance).
--
-- Additive + idempotent. Function bodies reproduce the latest definitions LIVE IN PROD
-- (read-only pg_proc check, 2026-10-03) exactly, apart from the lines marked [ADDED]:
--   mcp_debit_credits      ← 20260712_mcp_credit_ledger.sql
--   mcp_grant_credits      ← 20260712_mcp_credit_ledger.sql
--   mcp_autorecharge_claim ← 20260716_mcp_autorecharge.sql
--   mcp_apply_credit       ← 20260915_credit_pools_grant_paths.sql
--   mcp_topup_to_ceiling   ← 20260915_credit_pools_grant_paths.sql (the allowance-based
--                            body prod runs; the lexically-later sponsor_* files hold OLDER
--                            bodies that were applied earlier in time)
-- Not modified: mcp_grant_signup_credits (fixed reason 'signup_grant' → never resets),
-- mcp_transfer_personal_to_pool (only LOWERS the personal balance → S unchanged).
-- The BEFORE trigger trg_mcp_credit_pool_guard reads/writes only balance and
-- purchased_balance, so writing S in the same UPDATE is inert to it.
-- ============================================================================

-- ---- 1. S: ChatGPT spend in the current attribution window -----------------------
ALTER TABLE mcp_credit_balance
  ADD COLUMN IF NOT EXISTS chatgpt_spend_since_recharge INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mcp_credit_balance_chatgpt_spend_nonneg'
       AND conrelid = 'mcp_credit_balance'::regclass
  ) THEN
    ALTER TABLE mcp_credit_balance
      ADD CONSTRAINT mcp_credit_balance_chatgpt_spend_nonneg
      CHECK (chatgpt_spend_since_recharge >= 0);
  END IF;
END $$;

COMMENT ON COLUMN mcp_credit_balance.chatgpt_spend_since_recharge IS
  'S: personal credits debited via the ChatGPT channel since the last INDEPENDENT FUNDING EVENT (a grant whose reason is in mcp_grant_resets_chatgpt_window). balance + S = the balance without ChatGPT in this window. Auto-recharge is permitted only when balance + S < threshold.';

-- ---- 2. Audit: which surface originated a ledger row ----------------------------
ALTER TABLE mcp_credit_ledger
  ADD COLUMN IF NOT EXISTS channel TEXT;

COMMENT ON COLUMN mcp_credit_ledger.channel IS
  'Originating MCP surface for a debit. NULL = the Claude/general edge (and every row written before 2026-10-03). ''chatgpt'' = /chatgpt/mcp.';

-- ---- 3. THE ONE ALLOWLIST: grant reasons that are independent funding events -----
-- RESET = new customer entitlement the customer paid for (directly or by subscription).
-- Everything else — admin/debug, promo/free/signup, referral, refunds/corrections,
-- migrations, pool transfers, comp resets, sponsor top-ups (pending owner
-- classification), and ANY reason not listed here — does NOT reset.
-- Mirrored (and test-asserted equal) in src/lib/mcp/grant-reasons.ts.
CREATE OR REPLACE FUNCTION mcp_grant_resets_chatgpt_window(p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_reason = ANY (ARRAY[
    'auto_recharge',     -- successful off-session auto-recharge (card charged)
    'stripe_topup',      -- customer-paid manual top-up (Checkout)
    'pro_monthly',       -- Pro monthly allowance to a personal balance (cron)
    'app_tier_pro',      -- Pro subscription invoice: monthly allowance grant
    'app_tier_team',     -- Team subscription invoice, legacy PERSONAL grant (no pool)
    'mcp_sub_monthly',   -- MCP subscription renewal credit grant (monthly)
    'mcp_sub_annual'     -- MCP subscription renewal credit grant (annual)
  ]::TEXT[]), false)
$$;

-- ---- 4. The single eligibility rule (mirrored by rechargeGate() in autorecharge.ts)
CREATE OR REPLACE FUNCTION mcp_recharge_gate(
  p_balance INTEGER, p_chatgpt_spend INTEGER, p_threshold INTEGER
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_balance, 0) >= p_threshold THEN 'sufficient'
    WHEN COALESCE(p_balance, 0) + COALESCE(p_chatgpt_spend, 0) >= p_threshold THEN 'chatgpt_caused'
    ELSE 'eligible'
  END
$$;

-- ---- 5. Personal debit: + p_channel (DEFAULT NULL keeps every 5-arg caller working)
-- Drop the old 5-arg signature so PostgREST never sees two candidates for a named-arg
-- call (an overload with a defaulted 6th param would make a 5-arg call ambiguous).
DROP FUNCTION IF EXISTS mcp_debit_credits(TEXT, INTEGER, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION mcp_debit_credits(
  p_user TEXT, p_amount INTEGER, p_reason TEXT, p_tool TEXT, p_api_key_id UUID,
  p_channel TEXT DEFAULT NULL
) RETURNS TABLE(ok BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    -- Nothing to charge (free tool): report current balance, no ledger row.
    RETURN QUERY SELECT true, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- [ADDED] S grows in the SAME guarded statement as the debit, so balance + S is
  -- invariant under a ChatGPT debit and no reader can observe one without the other.
  UPDATE mcp_credit_balance
     SET balance = balance - p_amount,
         chatgpt_spend_since_recharge = chatgpt_spend_since_recharge
           + CASE WHEN p_channel = 'chatgpt' THEN p_amount ELSE 0 END,
         updated_at = now()
   WHERE user_email = p_user AND balance >= p_amount
   RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, tool_name, api_key_id, balance_after, channel)
  VALUES (p_user, -p_amount, p_reason, p_tool, p_api_key_id, v_balance, p_channel);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- ---- 6. Claim: + the attribution gate, BEFORE debounce/cap stamping --------------
CREATE OR REPLACE FUNCTION mcp_autorecharge_claim(
  p_user TEXT, p_debounce_seconds INTEGER, p_daily_cap INTEGER
) RETURNS TABLE(claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  r mcp_autorecharge%ROWTYPE;
  v_balance INTEGER;   -- [ADDED]
  v_spend   INTEGER;   -- [ADDED]
  v_gate    TEXT;      -- [ADDED]
BEGIN
  SELECT * INTO r FROM mcp_autorecharge WHERE user_email = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_settings'; RETURN; END IF;
  IF NOT r.enabled THEN RETURN QUERY SELECT false, 'disabled'; RETURN; END IF;
  IF r.paused THEN RETURN QUERY SELECT false, 'paused'; RETURN; END IF;
  IF r.stripe_customer_id IS NULL OR r.stripe_payment_method_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_card'; RETURN;
  END IF;

  -- [ADDED] Attribution gate. Placed BEFORE the debounce/cap checks and the stamping
  -- below, so a suppressed claim consumes neither the debounce slot nor a daily attempt.
  -- The balance row is read without a lock: a ChatGPT debit moves balance and S in one
  -- statement (balance + S unchanged), a normal debit only lowers balance + S, so a
  -- stale read can only suppress, never wrongly admit, on account of debits.
  SELECT b.balance, b.chatgpt_spend_since_recharge INTO v_balance, v_spend
    FROM mcp_credit_balance b WHERE b.user_email = p_user;
  v_balance := COALESCE(v_balance, 0);
  v_spend   := COALESCE(v_spend, 0);
  v_gate    := mcp_recharge_gate(v_balance, v_spend, r.threshold_credits);
  IF v_gate <> 'eligible' THEN
    RETURN QUERY SELECT false, v_gate; RETURN;
  END IF;

  IF r.last_attempt_at IS NOT NULL
     AND r.last_attempt_at > now() - make_interval(secs => p_debounce_seconds) THEN
    RETURN QUERY SELECT false, 'debounced'; RETURN;
  END IF;

  -- Roll the daily counter when the date turns over (UTC).
  IF r.attempts_today_date IS DISTINCT FROM CURRENT_DATE THEN
    r.attempts_today := 0;
    r.attempts_today_date := CURRENT_DATE;
  END IF;
  IF r.attempts_today >= p_daily_cap THEN
    RETURN QUERY SELECT false, 'daily_cap'; RETURN;
  END IF;

  UPDATE mcp_autorecharge
     SET last_attempt_at     = now(),
         attempts_today      = r.attempts_today + 1,
         attempts_today_date = CURRENT_DATE,
         updated_at          = now()
   WHERE user_email = p_user;

  RETURN QUERY SELECT true, 'ok';
END $$;

-- ---- 7. Idempotent grant: + window reset for allowlisted reasons -----------------
CREATE OR REPLACE FUNCTION mcp_apply_credit(
  p_key TEXT, p_user TEXT, p_credits INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_is_purchase BOOLEAN := p_reason IN ('stripe_topup', 'auto_recharge');
  v_resets BOOLEAN := mcp_grant_resets_chatgpt_window(p_reason);   -- [ADDED]
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
      -- [ADDED] an independent funding event starts a new attribution window
      chatgpt_spend_since_recharge = CASE WHEN v_resets THEN 0
                                          ELSE mcp_credit_balance.chatgpt_spend_since_recharge END,
      updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_credits, p_reason, v_balance);

  RETURN QUERY SELECT true, v_balance;
END $$;

-- ---- 8. Non-idempotent grant (admin/comp paths): + the same allowlist check ------
-- Today's callers pass only NO-RESET reasons (admin_grant, comp_reset); the check is
-- here so the allowlist is the single decision for EVERY personal grant path.
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
    DO UPDATE SET balance = mcp_credit_balance.balance + p_amount,
                  -- [ADDED]
                  chatgpt_spend_since_recharge = CASE WHEN mcp_grant_resets_chatgpt_window(p_reason) THEN 0
                                                      ELSE mcp_credit_balance.chatgpt_spend_since_recharge END,
                  updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_amount, p_reason, v_balance);

  RETURN v_balance;
END $$;

-- ---- 9. Sponsor ceiling top-up: + the same allowlist check -----------------------
-- Its only reason today is 'sponsor_monthly' → NO RESET (pending owner classification);
-- reclassifying it is a one-line change to the allowlist above, nothing here.
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
     SET balance = balance + v_short,
         -- [ADDED]
         chatgpt_spend_since_recharge = CASE WHEN mcp_grant_resets_chatgpt_window(p_reason) THEN 0
                                             ELSE chatgpt_spend_since_recharge END,
         updated_at = now()
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
