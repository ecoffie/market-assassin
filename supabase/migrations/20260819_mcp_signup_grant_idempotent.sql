-- MCP signup grant: make "grant exactly once per user" a DATABASE guarantee.
--
-- WHY. grantSignupCreditsIfFirst() decided eligibility in JS: SELECT the balance
-- row, and if none exists, grant. That is a read-then-write race. It was tolerable
-- while only TWO call sites existed (OAuth token exchange, API-key mint), because a
-- user rarely hits both within the same few milliseconds.
--
-- We are about to widen the grant to fire on the FIRST AUTHENTICATED MCP TOUCH —
-- OAuth completion, connector authorization, key creation, or the first tool
-- request — because 116 of 133 signups in the last 14 days (87%) ended up with NO
-- credit row and therefore could not make a single call. Widening the call sites
-- multiplies the race: a client that completes OAuth and immediately issues a tool
-- call can run two grants concurrently, and both would see "no balance row".
--
-- So the uniqueness moves into Postgres, where concurrency is actually settled.
--
-- MECHANISM. A partial unique index over the ledger: at most ONE 'signup_grant' row
-- per user, ever. The grant function inserts that ledger row FIRST and lets the
-- index arbitrate — a second concurrent caller takes the ON CONFLICT branch, skips
-- the balance mutation entirely, and returns the existing balance. No advisory
-- locks, no serializable retries: the winner is decided by the index.

-- ---- 1. One signup grant per user, enforced by the database ----------------
-- Partial index: only 'signup_grant' rows participate, so tool_call / admin_grant /
-- stripe_topup rows are unaffected and a user can still have many of those.
--
-- Pre-existing duplicates would make this index creation fail, which is the correct
-- outcome — it would mean someone was double-granted and that needs a human, not a
-- silent de-dupe. (Checked before authoring: zero users currently hold more than one
-- signup_grant row.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_credit_ledger_one_signup_grant
  ON mcp_credit_ledger (user_email)
  WHERE reason = 'signup_grant';

-- ---- 2. Idempotent signup grant ------------------------------------------
-- Returns the granted amount (0 when the user already had one), plus the resulting
-- balance, so the caller can tell "I granted" from "already had it" without a
-- second round trip.
CREATE OR REPLACE FUNCTION mcp_grant_signup_credits(
  p_user TEXT, p_amount INTEGER
) RETURNS TABLE(granted INTEGER, balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance INTEGER;
  v_email   TEXT := lower(trim(p_user));
  v_rows    INTEGER;
BEGIN
  IF p_amount <= 0 OR v_email = '' THEN
    RETURN QUERY SELECT 0, COALESCE((SELECT b.balance FROM mcp_credit_balance b WHERE b.user_email = v_email), 0);
    RETURN;
  END IF;

  -- Claim the grant by inserting the LEDGER row first. balance_after is patched
  -- below once the balance is known; the index decides the winner here.
  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (v_email, p_amount, 'signup_grant', 0)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- Someone already holds this user's signup grant. Do NOT touch the balance.
    RETURN QUERY SELECT 0, COALESCE((SELECT b.balance FROM mcp_credit_balance b WHERE b.user_email = v_email), 0);
    RETURN;
  END IF;

  -- We won the claim — apply the credits.
  INSERT INTO mcp_credit_balance(user_email, balance)
  VALUES (v_email, p_amount)
  ON CONFLICT (user_email)
    DO UPDATE SET balance = mcp_credit_balance.balance + p_amount, updated_at = now()
  RETURNING mcp_credit_balance.balance INTO v_balance;

  -- Patch the ledger row we just claimed with the true post-grant balance, so the
  -- audit trail reconciles (delta + prior == balance_after) like every other row.
  UPDATE mcp_credit_ledger
     SET balance_after = v_balance
   WHERE user_email = v_email AND reason = 'signup_grant';

  RETURN QUERY SELECT p_amount, v_balance;
END $$;

REVOKE ALL ON FUNCTION mcp_grant_signup_credits(TEXT, INTEGER) FROM anon, authenticated, PUBLIC;
