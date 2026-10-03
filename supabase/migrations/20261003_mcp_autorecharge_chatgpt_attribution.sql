-- ============================================================================
-- ChatGPT-attributed auto-recharge suppression  (2026-10-03)
--
-- OWNER-APPROVED INVARIANT (frozen):
--   An automatic payment is permitted only if the account would still be eligible if
--   every ChatGPT-originated debit since the last successful recharge were removed from
--   the eligibility calculation.
--
-- WHY: the /chatgpt/mcp surface (PR #1776) bills the SAME personal balance as Claude.
-- Without this, ChatGPT usage could drain a balance under the user's threshold and the
-- hourly cron (/api/cron/mcp-autorecharge) would charge their saved card for it — a card
-- payment caused by a surface that is never allowed to sell or upsell (owner decision 2).
--
-- MODEL:
--   S = mcp_credit_balance.chatgpt_spend_since_recharge
--     · a ChatGPT personal debit of a     → S += a   (same statement as the debit)
--     · any other debit                   → S unchanged (NOT reset)
--     · pool debits                       → never touch mcp_credit_balance, so never S
--     · grants (pro monthly/top-up/admin) → S unchanged
--   Eligibility, with T = the CURRENT threshold_credits:
--       balance <  T  AND  balance + S < T            → eligible
--       balance >= T                                  → 'sufficient'
--       balance <  T  AND  balance + S >= T           → 'chatgpt_caused'
--   (balance + S is the balance the account would have had without ChatGPT.)
--   Window reset: when the claim SUCCEEDS it snapshots the S it decided on into
--   mcp_autorecharge.claimed_chatgpt_spend. When the auto_recharge grant is APPLIED
--   (mcp_apply_credit, exactly-once per PaymentIntent — engine or webhook backstop),
--   S := GREATEST(S - snapshot, 0) and the snapshot is cleared, atomically, in the grant
--   transaction. ChatGPT spend during claim→grant carries into the next window. A
--   declined PaymentIntent never reaches mcp_apply_credit, so it resets nothing.
--
-- LOCK ORDER (deadlock-free): the claim locks mcp_autorecharge, then reads the balance
-- row WITHOUT a lock; a resetting grant locks mcp_autorecharge BEFORE the balance row.
-- Debits lock only the balance row. A stale unlocked read in the claim is conservative:
-- a concurrent ChatGPT debit changes balance and S in ONE statement (H unchanged), a
-- concurrent normal debit only lowers H, and a concurrent grant was already a race the
-- engine accepted before this migration (it read the balance in TS, outside the claim).
--
-- Additive + idempotent. Function bodies reproduce the latest prior definitions exactly
-- apart from the marked additions:
--   mcp_debit_credits      ← 20260712_mcp_credit_ledger.sql
--   mcp_autorecharge_claim ← 20260716_mcp_autorecharge.sql
--   mcp_apply_credit       ← 20260915_credit_pools_grant_paths.sql
-- The BEFORE trigger trg_mcp_credit_pool_guard only reads/writes balance and
-- purchased_balance, so writing chatgpt_spend_since_recharge in the same UPDATE is inert
-- to it (verified in the PGlite suite, which runs with the trigger installed).
-- ============================================================================

-- ---- 1. S: ChatGPT spend since the last successful auto-recharge ----------------
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
  'S: personal credits debited via the ChatGPT channel since the last successful auto-recharge. balance + S = the balance without ChatGPT. Auto-recharge is permitted only when balance + S < threshold. Reduced only by an applied auto_recharge grant (by the snapshot taken at claim).';

-- ---- 2. Snapshot of S taken when a claim succeeds -------------------------------
ALTER TABLE mcp_autorecharge
  ADD COLUMN IF NOT EXISTS claimed_chatgpt_spend INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mcp_autorecharge_claimed_chatgpt_spend_nonneg'
       AND conrelid = 'mcp_autorecharge'::regclass
  ) THEN
    ALTER TABLE mcp_autorecharge
      ADD CONSTRAINT mcp_autorecharge_claimed_chatgpt_spend_nonneg
      CHECK (claimed_chatgpt_spend IS NULL OR claimed_chatgpt_spend >= 0);
  END IF;
END $$;

COMMENT ON COLUMN mcp_autorecharge.claimed_chatgpt_spend IS
  'S as read by the last SUCCESSFUL mcp_autorecharge_claim. Subtracted from S (floored at 0) and cleared when that recharge''s auto_recharge grant is applied. NULL = no pending claim.';

-- ---- 3. Audit: which surface originated a ledger row ----------------------------
ALTER TABLE mcp_credit_ledger
  ADD COLUMN IF NOT EXISTS channel TEXT;

COMMENT ON COLUMN mcp_credit_ledger.channel IS
  'Originating MCP surface for a debit. NULL = the Claude/general edge (and every row written before 2026-10-03). ''chatgpt'' = /chatgpt/mcp.';

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

-- ---- 6. Claim: + the attribution gate (before debounce/cap stamping) + snapshot ----
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
     SET last_attempt_at       = now(),
         attempts_today        = r.attempts_today + 1,
         attempts_today_date   = CURRENT_DATE,
         claimed_chatgpt_spend = v_spend,   -- [ADDED] the S this decision used
         updated_at            = now()
   WHERE user_email = p_user;

  RETURN QUERY SELECT true, 'ok';
END $$;

-- ---- 7. Idempotent grant: + window reset for the resetting reasons ----------------
CREATE OR REPLACE FUNCTION mcp_apply_credit(
  p_key TEXT, p_user TEXT, p_credits INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_is_purchase BOOLEAN := p_reason IN ('stripe_topup', 'auto_recharge');
  -- [ADDED] THE ONE LIST of grant reasons that close the ChatGPT attribution window.
  -- Owner-approved scope is auto_recharge only. Adding a reason here (e.g. 'stripe_topup')
  -- makes that grant forgive ALL of S; auto_recharge forgives only its claim snapshot.
  v_resets_window BOOLEAN := p_reason IN ('auto_recharge');
  v_forgive INTEGER;   -- [ADDED] NULL = forgive all of S
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

  -- [ADDED] Read + lock the claim snapshot BEFORE the balance row (same lock order as
  -- mcp_autorecharge_claim: settings → balance). Reached at most once per key, so an
  -- engine grant + a webhook backstop grant for the same PaymentIntent reset once.
  IF v_resets_window THEN
    IF p_reason = 'auto_recharge' THEN
      SELECT COALESCE(claimed_chatgpt_spend, 0) INTO v_forgive
        FROM mcp_autorecharge WHERE user_email = p_user FOR UPDATE;
      v_forgive := COALESCE(v_forgive, 0);
      UPDATE mcp_autorecharge SET claimed_chatgpt_spend = NULL WHERE user_email = p_user;
    ELSE
      v_forgive := NULL;
    END IF;
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
      -- [ADDED]
      chatgpt_spend_since_recharge = CASE
        WHEN v_resets_window THEN GREATEST(
          mcp_credit_balance.chatgpt_spend_since_recharge
            - COALESCE(v_forgive, mcp_credit_balance.chatgpt_spend_since_recharge),
          0)
        ELSE mcp_credit_balance.chatgpt_spend_since_recharge
      END,
      updated_at = now()
  RETURNING balance INTO v_balance;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, p_credits, p_reason, v_balance);

  RETURN QUERY SELECT true, v_balance;
END $$;

NOTIFY pgrst, 'reload schema';
