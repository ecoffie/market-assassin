-- Atomic debit against an ORGANIZATION pool, with actor/payer provenance.
--
-- PR 3 of the Teams shared-MCP sequence. This adds the RPC; the resolution logic that
-- decides WHEN to call it lives in src/lib/mcp/payer.ts. Personal debits keep using
-- `mcp_debit_credits` completely unchanged — this function is additive, and a caller
-- that never resolves an org never reaches it.
--
-- ── DELIBERATELY A MIRROR, NOT A GENERALISATION ──────────────────────────────
-- This is `mcp_debit_credits` with the balance row swapped for a pool row. It was
-- tempting to fold both into one polymorphic function; that would have put a branch
-- inside the one piece of code whose correctness the whole credit system rests on.
-- Two small functions that each do one thing are easier to prove than one that does
-- two. The atomicity property is identical and comes from the same place:
--
--     UPDATE … SET balance = balance - amount WHERE balance >= amount RETURNING
--
-- The WHERE clause IS the concurrency gate. Postgres takes a row lock for the update,
-- so N seats hitting one pool serialise on that row: each either sees enough balance
-- and wins, or sees too little and gets NOT FOUND. Two members cannot both spend the
-- last credit. No advisory lock, no SELECT-then-UPDATE, no application-level mutex.
--
-- ── WHY THE LEDGER ROW CARRIES BOTH IDENTITIES ───────────────────────────────
-- `user_email` stays the ACTOR for backward compatibility — every existing reader
-- (usage panels, billing history, the account API) filters on it and must keep
-- working. `actor_email` repeats it explicitly so the column means the same thing on
-- pooled and personal rows, and `charged_pool_id` names the payer. A Team admin asking
-- "who spent our credits?" reads actor_email; "what did this pool pay for?" reads
-- charged_pool_id. Before this, one column had to answer both and could answer neither.
--
-- ⚠️ NO FALLBACK, BY DESIGN. If the pool has insufficient balance this returns
-- ok=false and touches nothing. It does NOT fall through to the actor's personal
-- balance. Silent cross-payer fallback would make provenance meaningless and charge a
-- person for their employer's work without either party choosing it. The caller
-- surfaces the refusal; a human decides what happens next.

CREATE OR REPLACE FUNCTION mcp_debit_pool(
  p_pool_id UUID,
  p_actor   TEXT,
  p_amount  INTEGER,
  p_reason  TEXT,
  p_tool    TEXT,
  p_api_key_id UUID
) RETURNS TABLE(ok BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    -- Free tool: report the pool's balance, write no ledger row. Mirrors the personal
    -- path exactly so a zero-cost call behaves identically on both.
    RETURN QUERY SELECT true, COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  -- THE GATE. Guarded subtraction under a row lock — see the header.
  UPDATE mcp_credit_pool
     SET balance = balance - p_amount, updated_at = now()
   WHERE pool_id = p_pool_id AND balance >= p_amount
   RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    -- Insufficient (or no such pool). Report the true balance; charge NOTHING.
    RETURN QUERY SELECT false, COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  -- user_email = the ACTOR, so existing per-user readers keep working unchanged.
  -- actor_email restates it; charged_pool_id names the payer.
  INSERT INTO mcp_credit_ledger(
    user_email, delta, reason, tool_name, api_key_id, balance_after,
    actor_email, charged_pool_id
  )
  VALUES (
    p_actor, -p_amount, p_reason, p_tool, p_api_key_id, v_balance,
    p_actor, p_pool_id
  );

  RETURN QUERY SELECT true, v_balance;
END $$;

COMMENT ON FUNCTION mcp_debit_pool IS
  'Atomic debit against an organization pool. Mirrors mcp_debit_credits; the WHERE balance >= amount clause is the concurrency gate. NEVER falls back to a personal balance on insufficient funds.';

-- Fund a pool. Used by the Team monthly grant in PR 4; no caller yet.
CREATE OR REPLACE FUNCTION mcp_grant_pool(
  p_pool_id UUID, p_amount INTEGER, p_reason TEXT, p_actor TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RETURN COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
  END IF;

  UPDATE mcp_credit_pool
     SET balance = balance + p_amount, updated_at = now()
   WHERE pool_id = p_pool_id
   RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_grant_pool: no pool %', p_pool_id;
  END IF;

  INSERT INTO mcp_credit_ledger(
    user_email, delta, reason, balance_after, actor_email, charged_pool_id
  )
  VALUES (COALESCE(p_actor, 'system'), p_amount, p_reason, v_balance, p_actor, p_pool_id);

  RETURN v_balance;
END $$;

COMMENT ON FUNCTION mcp_grant_pool IS
  'Credit an organization pool (Team monthly grant, PR 4). Raises if the pool does not exist rather than silently creating one.';
