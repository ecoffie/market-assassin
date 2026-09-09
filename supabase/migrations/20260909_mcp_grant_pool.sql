-- Fund an organization pool — the Team funding seam.
--
-- PR 4B. This is the counterpart to `mcp_debit_pool` (PR 3): debit proved the pool can
-- be SPENT atomically; this proves it can be FUNDED. It was deliberately removed from
-- PR 3 so that PR reviewed one behavioural seam (debit) rather than two.
--
-- ── IDEMPOTENCY LIVES IN POSTGRES, NOT IN THE CALLER ─────────────────────────
-- The monthly grant cron re-runs (a daily self-heal pass fires on every day that is
-- not the 1st), and Stripe webhooks re-deliver. A caller-side "have we granted yet?"
-- check is a read-then-write race: two concurrent runs both read "not yet" and both
-- grant. So the claim is made by INSERTing the idempotency key under a UNIQUE
-- constraint and letting Postgres pick the winner — the same shape
-- `mcp_apply_credit` already uses for personal grants.
--
-- KEY = `team:<stripe_subscription_id>:<YYYY-MM>`, deliberately keyed on the
-- SUBSCRIPTION and not an email. Measured 2026-09-08: the one live Team subscriber
-- holds TWO Stripe customer records with TWO active subscriptions under a single
-- email (Team $499 + Pro $149). An email-keyed grant cannot tell those apart and would
-- either double-grant or grant the wrong plan's amount. The subscription id is the
-- durable relationship; the email is display metadata.
--
-- ⚠️ NO PERSONAL FALLBACK, NO MIGRATION. This function only ever touches
-- `mcp_credit_pool`. It never reads, moves, or zeroes a personal `mcp_credit_balance`.
-- A Team member's personal credits stay theirs; the pool is separate money.

CREATE TABLE IF NOT EXISTS mcp_pool_grants (
  -- The idempotency key IS the primary key: a second attempt with the same key cannot
  -- insert, so it cannot grant. No application-level guard required.
  grant_key   TEXT PRIMARY KEY,
  pool_id     UUID NOT NULL REFERENCES mcp_credit_pool(pool_id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mcp_pool_grants IS
  'One row per pool grant, keyed by idempotency key (team:<stripe_subscription_id>:<YYYY-MM>). The PK is the guard — a repeat key cannot insert, so it cannot double-grant.';

ALTER TABLE mcp_pool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_pool_grants FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_pool_grants_service ON mcp_pool_grants;
CREATE POLICY mcp_pool_grants_service ON mcp_pool_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grant EXACTLY ONCE for an idempotency key. Returns whether it applied and the
-- resulting balance, mirroring `mcp_apply_credit`'s contract so callers read the same.
CREATE OR REPLACE FUNCTION mcp_grant_pool_once(
  p_key     TEXT,
  p_pool_id UUID,
  p_amount  INTEGER,
  p_reason  TEXT,
  p_actor   TEXT
) RETURNS TABLE(applied BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER; v_claimed INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  -- CLAIM FIRST. The insert either wins or does nothing; there is no window in which
  -- two runs both believe they should grant.
  INSERT INTO mcp_pool_grants(grant_key, pool_id, amount)
  VALUES (p_key, p_pool_id, p_amount)
  ON CONFLICT (grant_key) DO NOTHING;
  -- ROW_COUNT, not FOUND: `GET DIAGNOSTICS ... FOUND` is not valid plpgsql (42601).
  -- ON CONFLICT DO NOTHING sets ROW_COUNT to 1 when the claim was inserted and 0 when
  -- another run already held the key.
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed = 0 THEN
    -- Already granted for this key. Report the balance; mutate nothing.
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  UPDATE mcp_credit_pool
     SET balance = balance + p_amount, updated_at = now()
   WHERE pool_id = p_pool_id
   RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    -- The claim row references the pool by FK, so this cannot normally happen. Raising
    -- rolls back the claim too, leaving the key free for a legitimate retry — better
    -- than a consumed key that never funded anything.
    RAISE EXCEPTION 'mcp_grant_pool_once: no pool %', p_pool_id;
  END IF;

  -- Provenance: charged_pool_id names the funded pool, actor_email the granting agent
  -- (the cron, or an admin). reason distinguishes this from personal `pro_monthly`.
  INSERT INTO mcp_credit_ledger(
    user_email, delta, reason, balance_after, actor_email, charged_pool_id
  )
  VALUES (COALESCE(p_actor, 'system'), p_amount, p_reason, v_balance, p_actor, p_pool_id);

  RETURN QUERY SELECT true, v_balance;
END $$;

COMMENT ON FUNCTION mcp_grant_pool_once IS
  'Fund an org pool exactly once per idempotency key (team:<subscription_id>:<YYYY-MM>). Claims the key before mutating, so concurrent cron runs cannot double-grant. Never touches a personal balance.';
