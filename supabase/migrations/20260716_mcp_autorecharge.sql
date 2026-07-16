-- ============================================================================
-- MCP auto-recharge  (2026-07-16)
--
-- "Card on file, refill when low" — the OpenAI/Anthropic-API-style auto top-up.
-- One row per user holding: whether it's on, the low-balance THRESHOLD, which pack
-- to buy, and the saved Stripe customer + payment method (IDS ONLY — no card data
-- ever touches us; PCI stays with Stripe). Plus the safety counters: consecutive
-- failures (→ pause), a per-day attempt cap, and debounce timestamps so concurrent
-- low-balance tool calls fire ONE charge, not ten.
--
-- Grants still go through mcp_apply_credit (idempotent by the PaymentIntent id), so
-- this migration adds NO new granting path — only settings + an atomic claim guard.
-- Idempotent DDL; service_role-only. Run AFTER 20260712_mcp_credit_topups.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_autorecharge (
  user_email               TEXT PRIMARY KEY,
  enabled                  BOOLEAN NOT NULL DEFAULT false,
  threshold_credits        INTEGER NOT NULL DEFAULT 100,   -- refill when balance < this
  refill_package           TEXT    NOT NULL DEFAULT 'plus', -- CREDIT_PACKAGES id (plus|scale)
  stripe_customer_id       TEXT,
  stripe_payment_method_id TEXT,
  card_brand               TEXT,                            -- display only ("visa")
  card_last4               TEXT,                            -- display only ("4242")
  paused                   BOOLEAN NOT NULL DEFAULT false,  -- set after repeated declines
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,
  last_recharge_at         TIMESTAMPTZ,                     -- last SUCCESSFUL refill
  last_attempt_at          TIMESTAMPTZ,                     -- debounce / in-flight marker
  attempts_today           INTEGER NOT NULL DEFAULT 0,      -- per-day cap counter
  attempts_today_date      DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cron backstop scans "enabled AND NOT paused" rows and joins the balance table.
CREATE INDEX IF NOT EXISTS idx_mcp_autorecharge_active
  ON mcp_autorecharge (enabled, paused) WHERE enabled AND NOT paused;

-- ----------------------------------------------------------------------------
-- Atomic CLAIM: may this caller start a recharge right now? Prevents concurrent
-- double-charges (two low-balance tool calls racing) and enforces the debounce +
-- daily attempt cap in ONE row-locked transaction. Rolls the per-day counter when
-- the date changes. Returns claimed + a reason (for logs). On claim it stamps
-- last_attempt_at = now() and increments attempts_today, so a second caller within
-- the debounce window is rejected. Counting ATTEMPTS (not successes) means a failing
-- card can't burn through the cap indefinitely.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mcp_autorecharge_claim(
  p_user TEXT, p_debounce_seconds INTEGER, p_daily_cap INTEGER
) RETURNS TABLE(claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE r mcp_autorecharge%ROWTYPE;
BEGIN
  SELECT * INTO r FROM mcp_autorecharge WHERE user_email = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_settings'; RETURN; END IF;
  IF NOT r.enabled THEN RETURN QUERY SELECT false, 'disabled'; RETURN; END IF;
  IF r.paused THEN RETURN QUERY SELECT false, 'paused'; RETURN; END IF;
  IF r.stripe_customer_id IS NULL OR r.stripe_payment_method_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_card'; RETURN;
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

ALTER TABLE mcp_autorecharge ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_autorecharge FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_autorecharge_service ON mcp_autorecharge;
CREATE POLICY mcp_autorecharge_service ON mcp_autorecharge FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON mcp_autorecharge FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
