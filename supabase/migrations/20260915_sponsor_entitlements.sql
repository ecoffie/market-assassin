-- ============================================================================
-- Sponsor entitlements (2026-09-15)
--
-- A SPONSORED account gets a recurring monthly credit allowance paid for by a
-- sponsor rather than by the account holder. Before this, the only ways to give
-- someone recurring credits were (a) a paid Stripe subscription or (b) adding
-- their address to a hardcoded list in the grant cron (INTERNAL_TEAM_EMAILS /
-- ADVOCATE_ACCOUNTS). Neither records WHY the credits arrive, who is paying, or
-- when the arrangement ends — so a lapsed sponsorship grants forever and nobody
-- notices. This table is that missing record.
--
-- Keyed on user_id (stable) — email is contact/display only, so an address change
-- does not orphan the entitlement. The grant path still resolves to an email
-- because mcp_credit_balance is email-keyed; see sponsor_active_entitlements.
--
-- ⚠️ TOP-UP, NOT ADD. The monthly grant is max(0, allowance - current_balance):
-- it raises a low balance TO the allowance and never reduces a high one. The
-- shortfall MUST be computed inside the same locked statement that writes it —
-- computing it in app code and passing a constant to mcp_apply_credit is a
-- read-then-write race (the idempotency key stops a DUPLICATE grant, it does not
-- make the amount correct against a balance that moved in between).
--
-- Idempotent DDL; service_role only. Run after 20260712_mcp_credit_topups.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sponsor_entitlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable account identity. Email lives in user_profiles and is contact only.
  user_id           UUID NOT NULL,
  contact_email     TEXT NOT NULL,
  -- Who is paying, for the record. Free text: sponsors are not accounts.
  sponsor_name      TEXT NOT NULL,
  sponsor_contact   TEXT,
  -- Per-entitlement so different sponsors can carry different allowances.
  monthly_allowance INTEGER NOT NULL CHECK (monthly_allowance > 0),
  -- Enforced by the view below: an expired sponsorship stops granting by itself.
  starts_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_on        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'ended')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sponsor_entitlements_dates CHECK (expires_on > starts_on)
);

-- One ACTIVE entitlement per account. A second sponsor for the same person is a
-- policy question (whose allowance wins?), not something to silently double-grant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_entitlements_active_user
  ON sponsor_entitlements (user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sponsor_entitlements_lookup
  ON sponsor_entitlements (status, expires_on);

-- ----------------------------------------------------------------------------
-- The grant audience. Expiration is applied HERE, so no caller can forget it:
-- a row past expires_on simply stops appearing. Joins to user_profiles for the
-- current email (the entitlement holds identity; the credit ledger needs email).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW sponsor_active_entitlements AS
SELECT
  se.id,
  se.user_id,
  COALESCE(up.email, se.contact_email) AS user_email,
  se.sponsor_name,
  se.monthly_allowance,
  se.expires_on
FROM sponsor_entitlements se
LEFT JOIN user_profiles up ON up.user_id = se.user_id
WHERE se.status = 'active'
  AND CURRENT_DATE >= se.starts_on
  AND CURRENT_DATE < se.expires_on;

-- ----------------------------------------------------------------------------
-- ATOMIC TOP-UP TO A CEILING.
--
-- Computes the shortfall against the balance it LOCKS, in one statement, and
-- writes the guard row + balance + ledger together. Returns the amount actually
-- granted so the caller reports truth rather than its own intention.
--
-- Ordering matters: the idempotency guard is claimed FIRST (same pattern as
-- mcp_apply_credit), so a concurrent second call returns applied=false without
-- touching the balance. Then the balance row is locked and the shortfall derived
-- from the locked value.
--
-- Returns granted=0 with applied=true when the balance already meets the
-- ceiling — the month IS satisfied, it just needed nothing. That is a different
-- outcome from applied=false (someone else already granted this month), and the
-- caller distinguishes them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mcp_topup_to_ceiling(
  p_key TEXT, p_user TEXT, p_ceiling INTEGER, p_reason TEXT
) RETURNS TABLE(applied BOOLEAN, granted INTEGER, new_balance INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_current INTEGER;
  v_short   INTEGER;
  v_balance INTEGER;
BEGIN
  IF p_ceiling <= 0 THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- Claim the month. ON CONFLICT DO NOTHING leaves FOUND=false on a re-run, so a
  -- duplicate cron tick cannot grant twice. Credits recorded as 0 here; the real
  -- amount is only known after the lock below, and the ledger row is the receipt.
  INSERT INTO mcp_credit_topups(idempotency_key, user_email, credits, reason)
  VALUES (p_key, p_user, 0, p_reason)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0,
      COALESCE((SELECT balance FROM mcp_credit_balance WHERE user_email = p_user), 0);
    RETURN;
  END IF;

  -- Lock the balance row and read it in the same breath. A missing row is a real
  -- zero here (the account simply has no balance yet), NOT unknown — the INSERT
  -- below creates it. Do not confuse this with `count ?? 0` on a missing table.
  SELECT balance INTO v_current FROM mcp_credit_balance
    WHERE user_email = p_user FOR UPDATE;
  v_current := COALESCE(v_current, 0);

  v_short := GREATEST(0, p_ceiling - v_current);

  IF v_short = 0 THEN
    -- Already at or above the ceiling. The month is satisfied; never reduce.
    UPDATE mcp_credit_topups SET credits = 0 WHERE idempotency_key = p_key;
    RETURN QUERY SELECT true, 0, v_current;
    RETURN;
  END IF;

  INSERT INTO mcp_credit_balance(user_email, balance)
  VALUES (p_user, v_short)
  ON CONFLICT (user_email)
    DO UPDATE SET balance = mcp_credit_balance.balance + v_short, updated_at = now()
  RETURNING balance INTO v_balance;

  UPDATE mcp_credit_topups SET credits = v_short WHERE idempotency_key = p_key;

  INSERT INTO mcp_credit_ledger(user_email, delta, reason, balance_after)
  VALUES (p_user, v_short, p_reason, v_balance);

  RETURN QUERY SELECT true, v_short, v_balance;
END $$;

ALTER TABLE sponsor_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_entitlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsor_entitlements_service ON sponsor_entitlements;
CREATE POLICY sponsor_entitlements_service ON sponsor_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON sponsor_entitlements FROM anon, authenticated, PUBLIC;
REVOKE ALL ON sponsor_active_entitlements FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
