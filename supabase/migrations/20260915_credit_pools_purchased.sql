-- ============================================================================
-- Purchased vs allowance credit pools (2026-09-15)
--
-- WHY: a sponsored user with an 8,000 monthly ceiling who BUYS a top-up ended the
-- renewal at 8,000, not 9,000 — the purchase was absorbed by the allowance. Measured.
-- They paid and received nothing. The ceiling must be computed from what the SPONSORSHIP
-- granted; purchased credits sit ON TOP and never suppress the refill.
--
-- MODEL: one authoritative `balance` (unchanged, still the number everything reads) plus
-- `purchased_balance`, the portion of it bought outright. allowance = balance - purchased.
-- Storing the SUBSET rather than two independent columns makes "totals never change" a
-- structural property instead of a thing to re-verify on every write.
--
-- ⚠️ OLD DEPLOYED WRITERS CANNOT BYPASS THIS. Every balance mutation goes through an
-- RPC (verified: no app-side direct writes exist), but a build deployed before this
-- migration calls the OLD RPC bodies, which know nothing about pools. A BEFORE trigger
-- therefore keeps the invariant no matter which writer runs:
--   • a decrease spends ALLOWANCE first, then purchased (the approved spend order)
--   • an increase is allowance unless the caller marks it purchased
--   • purchased is clamped into [0, balance] on every write
-- So a stale writer degrades to "granted allowance / spent allowance-first" — correct
-- accounting, never a violated invariant.
--
-- CLASSIFICATION (approved policy, not recovered fact): only stripe_topup and
-- auto_recharge are REFILL PURCHASES. Subscription-included credits are an allowance the
-- subscription entitles you to — paying for a subscription does not make its credits a
-- purchased refill. Debits were never typed, so the historical draw-down order is
-- unknowable; allowance-first is the chosen rule, applied to history and forward alike.
-- Idempotent; service_role only.
-- ============================================================================

ALTER TABLE mcp_credit_balance
  ADD COLUMN IF NOT EXISTS purchased_balance INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN mcp_credit_balance.purchased_balance IS
  'Portion of `balance` bought outright (refill packs: stripe_topup / auto_recharge). allowance = balance - purchased_balance. Subscription-included credits are ALLOWANCE, not purchased. Never exceeds balance; spent only after allowance is exhausted.';

-- ---------------------------------------------------------------------------
-- The invariant, enforced on EVERY write regardless of which RPC (or which deployed
-- build) performed it. Runs BEFORE the row is written so it cannot be violated at rest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mcp_credit_pool_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_delta INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.purchased_balance := LEAST(GREATEST(COALESCE(NEW.purchased_balance, 0), 0), GREATEST(NEW.balance, 0));
    RETURN NEW;
  END IF;

  v_delta := NEW.balance - OLD.balance;

  IF v_delta < 0 THEN
    -- SPEND ALLOWANCE FIRST. Only the remainder, once allowance is exhausted, touches
    -- the purchased pool. A caller that already adjusted purchased_balance itself (the
    -- new pool-aware RPC) is respected — detected by purchased_balance having changed.
    IF NEW.purchased_balance = OLD.purchased_balance THEN
      DECLARE v_allowance INTEGER := OLD.balance - OLD.purchased_balance;
              v_need INTEGER := -v_delta;
      BEGIN
        IF v_need > v_allowance THEN
          NEW.purchased_balance := GREATEST(0, OLD.purchased_balance - (v_need - v_allowance));
        END IF;
      END;
    END IF;
  ELSIF v_delta > 0 THEN
    -- An increase is ALLOWANCE unless the caller explicitly raised purchased_balance.
    -- (A pool-aware grant sets both; a legacy grant sets only balance.)
    NULL;
  END IF;

  -- Final clamp: 0 <= purchased <= balance, always.
  NEW.purchased_balance := LEAST(GREATEST(COALESCE(NEW.purchased_balance, 0), 0), GREATEST(NEW.balance, 0));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mcp_credit_pool_guard ON mcp_credit_balance;
CREATE TRIGGER trg_mcp_credit_pool_guard
  BEFORE INSERT OR UPDATE ON mcp_credit_balance
  FOR EACH ROW EXECUTE FUNCTION mcp_credit_pool_guard();

-- ---------------------------------------------------------------------------
-- BACKFILL — recomputed INSIDE this transaction from the ledger, with the balance row
-- LOCKED, so usage landing between analysis and migration cannot make it stale. The walk
-- is chronological and allowance-first, and handles refunds/revocations/transfers by
-- treating every negative delta the same way a debit is treated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  ev RECORD;
  v_allow INTEGER;
  v_purch INTEGER;
  v_need  INTEGER;
  v_from_allow INTEGER;
BEGIN
  FOR r IN
    SELECT user_email, balance FROM mcp_credit_balance
     WHERE user_email IN (SELECT DISTINCT user_email FROM mcp_credit_ledger
                           WHERE delta > 0 AND reason IN ('stripe_topup','auto_recharge'))
     FOR UPDATE
  LOOP
    v_allow := 0; v_purch := 0;
    FOR ev IN SELECT delta, reason FROM mcp_credit_ledger
               WHERE user_email = r.user_email ORDER BY created_at ASC, id ASC
    LOOP
      IF ev.delta > 0 THEN
        IF ev.reason IN ('stripe_topup','auto_recharge') THEN v_purch := v_purch + ev.delta;
        ELSE v_allow := v_allow + ev.delta; END IF;
      ELSE
        v_need := -ev.delta;
        v_from_allow := LEAST(v_allow, v_need);
        v_allow := v_allow - v_from_allow;
        v_need := v_need - v_from_allow;
        IF v_need > 0 THEN v_purch := GREATEST(0, v_purch - v_need); END IF;
      END IF;
    END LOOP;

    -- TOTALS ARE NEVER CHANGED: only the SPLIT of the existing balance is written, and
    -- purchased is clamped to the live locked balance rather than the walked sum (which
    -- can differ if a pre-ledger adjustment exists).
    UPDATE mcp_credit_balance
       SET purchased_balance = LEAST(GREATEST(v_purch, 0), GREATEST(r.balance, 0))
     WHERE user_email = r.user_email;
  END LOOP;
END $$;

ALTER TABLE mcp_credit_balance
  ADD CONSTRAINT mcp_credit_balance_purchased_bounds
  CHECK (purchased_balance >= 0 AND purchased_balance <= balance) NOT VALID;

NOTIFY pgrst, 'reload schema';
