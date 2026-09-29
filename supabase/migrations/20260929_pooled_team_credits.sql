-- ============================================================================
-- Pooled team credits (PR 4B of the Teams shared-MCP sequence) — 2026-09-29
--
-- PRD: tasks/PRD-pooled-team-credits.md (approved by Eric 2026-09-29).
--
-- WHAT THIS ADDS (additive, idempotent, service_role only):
--   1. organizations.seat_limit / pool_monthly_credits / pool_plan_key
--      A pool is a capability of ANY subscription configured with more than one
--      seat, not of one price. The seat count is CONFIGURATION on the org (defaulted
--      from the plan, overridable for a negotiated deal) — it is NOT Stripe
--      `quantity`, which 20260908_org_stripe_linkage.sql measured as always 1.
--   2. org_member_invites — explicit, owner-issued, single-use invites. Billing
--      membership is only ever created by an invitee accepting one while signed in
--      as the invited address. Never inferred from an email domain.
--   3. mcp_pool_grants — the idempotency + audit table for every credit that ENTERS
--      a pool (monthly replenishment, the one-time Team migration). A pool has no
--      user_email, so mcp_credit_topups (user_email NOT NULL) cannot key it.
--   4. mcp_replenish_pool() — monthly top-up to the pool's allowance. Mirrors the
--      approved sponsor rule (20260915_sponsor_entitlement_ceiling.sql): the claim is
--      a (month, ceiling) pair, so a re-run is a no-op, a mid-month upgrade grants
--      only the difference, and spending never re-opens the month's grant.
--      Annual pooled subscriptions use this too — they replenish MONTHLY.
--   5. mcp_transfer_personal_to_pool() — the audited, idempotent move of a
--      subscriber's remaining Team-entitlement credits into their new pool. Moves
--      ALLOWANCE only: purchased credits cannot be moved by construction.
--
-- NOTHING here funds a pool on its own. The app calls these functions; the one-time
-- migration of the existing Team subscriber is a separate, dry-run-first script
-- (scripts/migrate-team-credits-to-pool.ts) that needs explicit approval to run.
-- ============================================================================

-- 1. Seat + allowance configuration on the organization --------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_limit INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pool_monthly_credits INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pool_plan_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_seat_limit_positive') THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_seat_limit_positive CHECK (seat_limit IS NULL OR seat_limit >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_pool_monthly_credits_nonneg') THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_pool_monthly_credits_nonneg
      CHECK (pool_monthly_credits IS NULL OR pool_monthly_credits >= 0);
  END IF;
END $$;

COMMENT ON COLUMN organizations.seat_limit IS
  'Named-user seats configured for this org''s subscription. > 1 makes the subscription pool-eligible. Configuration, not Stripe quantity.';
COMMENT ON COLUMN organizations.pool_monthly_credits IS
  'Monthly allowance the org''s credit pool is replenished to (top-up, never stacked). Annual subscriptions replenish monthly too.';
COMMENT ON COLUMN organizations.pool_plan_key IS
  'Which plan configuration provisioned this org (team, growth, agency, custom). Audit only.';

-- 2. Explicit invites -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_member_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by    TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_member_invites_pending
  ON org_member_invites (org_id, invited_email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_member_invites_email
  ON org_member_invites (invited_email, status);

ALTER TABLE org_member_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_member_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_member_invites_service ON org_member_invites;
CREATE POLICY org_member_invites_service ON org_member_invites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Pool grant claims + audit ------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_pool_grants (
  idempotency_key TEXT PRIMARY KEY,
  pool_id         UUID NOT NULL REFERENCES mcp_credit_pool(pool_id) ON DELETE RESTRICT,
  credits         INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  reason          TEXT NOT NULL,
  source_email    TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_pool_grants_pool
  ON mcp_pool_grants (pool_id, created_at DESC);

ALTER TABLE mcp_pool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_pool_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_pool_grants_service ON mcp_pool_grants;
CREATE POLICY mcp_pool_grants_service ON mcp_pool_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Monthly replenishment ------------------------------------------------------------
-- p_key is a BASE key, e.g. pool:<org_id>:<YYYY-MM>. The claim is p_key || ':c' || ceiling.
-- The ledger row's user_email is the sentinel 'pool:<pool_id>' so pool grants never
-- appear in any person's personal billing history; charged_pool_id names the pool.
CREATE OR REPLACE FUNCTION mcp_replenish_pool(
  p_key TEXT, p_pool_id UUID, p_ceiling INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, granted INTEGER, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_current INTEGER;
  v_short   INTEGER;
  v_balance INTEGER;
  v_claim   TEXT;
  v_granted_this_month INTEGER;
BEGIN
  IF p_ceiling IS NULL OR p_ceiling <= 0 THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  -- Lock the pool FIRST: a missing pool is an error, never a silent no-op.
  SELECT balance INTO v_current FROM mcp_credit_pool WHERE pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_replenish_pool: no pool %', p_pool_id;
  END IF;

  v_claim := p_key || ':c' || p_ceiling::TEXT;
  INSERT INTO mcp_pool_grants(idempotency_key, pool_id, credits, reason)
  VALUES (v_claim, p_pool_id, 0, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, v_current;   -- this (month, ceiling) already claimed
    RETURN;
  END IF;

  -- Never stacked, never refilled by spending: bounded by what this month already
  -- granted under ANY ceiling, and by the pool's actual shortfall.
  SELECT COALESCE(SUM(credits), 0) INTO v_granted_this_month
    FROM mcp_pool_grants
   WHERE pool_id = p_pool_id
     AND idempotency_key LIKE p_key || ':c%';

  v_short := LEAST(
    GREATEST(0, p_ceiling - v_granted_this_month),
    GREATEST(0, p_ceiling - v_current)
  );

  IF v_short = 0 THEN
    RETURN QUERY SELECT true, 0, v_current;
    RETURN;
  END IF;

  UPDATE mcp_credit_pool
     SET balance = balance + v_short, updated_at = now()
   WHERE pool_id = p_pool_id
  RETURNING balance INTO v_balance;

  UPDATE mcp_pool_grants SET credits = v_short WHERE idempotency_key = v_claim;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, charged_pool_id)
  VALUES ('pool:' || p_pool_id::TEXT, v_short, p_reason, v_balance, p_pool_id);

  RETURN QUERY SELECT true, v_short, v_balance;
END $$;

-- 5. Audited personal → pool transfer (one-time Team migration) ------------------------
-- Moves ALLOWANCE only. Refuses (raises) if p_amount exceeds the personal allowance
-- (balance - purchased_balance), so purchased credits can never be moved. Idempotent
-- on p_key: a replay returns applied=false and moves nothing.
CREATE OR REPLACE FUNCTION mcp_transfer_personal_to_pool(
  p_key TEXT, p_user TEXT, p_pool_id UUID, p_amount INTEGER, p_details JSONB
) RETURNS TABLE(applied BOOLEAN, moved INTEGER, personal_balance INTEGER, pool_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_bal       INTEGER;
  v_purchased INTEGER;
  v_personal  INTEGER;
  v_pool      INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'mcp_transfer_personal_to_pool: amount must be positive (got %)', p_amount;
  END IF;

  INSERT INTO mcp_pool_grants(idempotency_key, pool_id, credits, reason, source_email, details)
  VALUES (p_key, p_pool_id, 0, 'pool_migration_in', lower(p_user), COALESCE(p_details, '{}'::jsonb))
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = lower(p_user)), 0),
      COALESCE((SELECT balance FROM mcp_credit_pool WHERE pool_id = p_pool_id), 0);
    RETURN;
  END IF;

  SELECT balance, purchased_balance INTO v_bal, v_purchased
    FROM mcp_credit_balance WHERE user_email = lower(p_user) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_transfer_personal_to_pool: no balance row for %', p_user;
  END IF;
  IF p_amount > (v_bal - COALESCE(v_purchased, 0)) THEN
    RAISE EXCEPTION 'mcp_transfer_personal_to_pool: % exceeds allowance % (purchased credits are never moved)',
      p_amount, v_bal - COALESCE(v_purchased, 0);
  END IF;

  PERFORM 1 FROM mcp_credit_pool WHERE pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_transfer_personal_to_pool: no pool %', p_pool_id;
  END IF;

  -- The purchased-vs-allowance trigger spends allowance first on a decrease, so
  -- purchased_balance is untouched by this update.
  UPDATE mcp_credit_balance
     SET balance = balance - p_amount, updated_at = now()
   WHERE user_email = lower(p_user)
  RETURNING balance INTO v_personal;

  UPDATE mcp_credit_pool
     SET balance = balance + p_amount, updated_at = now()
   WHERE pool_id = p_pool_id
  RETURNING balance INTO v_pool;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, charged_pool_id, actor_email)
  VALUES (lower(p_user), -p_amount, 'pool_migration_out', v_personal, p_pool_id, lower(p_user));
  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after, charged_pool_id, actor_email)
  VALUES ('pool:' || p_pool_id::TEXT, p_amount, 'pool_migration_in', v_pool, p_pool_id, lower(p_user));

  UPDATE mcp_pool_grants SET credits = p_amount WHERE idempotency_key = p_key;

  RETURN QUERY SELECT true, p_amount, v_personal, v_pool;
END $$;

NOTIFY pgrst, 'reload schema';
