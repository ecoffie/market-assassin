-- ============================================================================
-- Prepaid (off-Stripe) monthly credit entitlements (2026-10-05)
--
-- WHY: the monthly MCP grant (/api/cron/grant-mcp-pro-credits) enumerates its paid
-- audience from ACTIVE Stripe subscriptions. A customer who paid for Pro OUTSIDE Stripe
-- (invoice / Wave / wire) therefore gets month 1 by hand and nothing after. The only
-- dated non-Stripe source, sponsor_entitlements, does not fit: it needs an auth user_id
-- (a prepaid buyer may not have signed up yet) and it TOPS UP to a ceiling, so a user
-- holding unspent credits would receive less than the allowance they paid for.
--
-- WHAT: one row = a fixed monthly allowance ADDED once per calendar month (UTC) from
-- first_month through last_month inclusive, then nothing. The grant job claims each
-- month under the SAME key every other grant path uses — pro:<email>:<YYYY-MM> — so a
-- retry, a catch-up, or a later Stripe subscription cannot credit a month twice.
--
-- The access window is recorded beside the grant schedule and the CHECK below binds them:
-- the last granted month is the one in which access ends, i.e.
--   last_month + 1 month <= access_ends_on < last_month + 2 months.
-- (2026-10-05 → 2027-04-05 grants Oct..Mar = 6 months; April is never granted.)
--
-- Idempotent DDL; service_role only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_prepaid_entitlements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Email, not user_id: the credit ledger and the KV access gate are both email-keyed,
  -- and a prepaid buyer may not have an auth account yet.
  user_email       TEXT NOT NULL CHECK (user_email = lower(btrim(user_email)) AND user_email LIKE '%@%'),
  monthly_credits  INTEGER NOT NULL CHECK (monthly_credits > 0),
  -- First day of the first and last granted months (UTC calendar months, inclusive).
  first_month      DATE NOT NULL CHECK (EXTRACT(DAY FROM first_month) = 1),
  last_month       DATE NOT NULL CHECK (EXTRACT(DAY FROM last_month) = 1),
  -- The Pro access window this allowance accompanies (KV briefings:<email> TTL).
  access_starts_on DATE NOT NULL,
  access_ends_on   DATE NOT NULL,
  -- How it was paid, for the record (mirrors member grant provenance).
  source           TEXT NOT NULL CHECK (source IN ('invoice', 'wire', 'bootcamp', 'bundle', 'other')),
  reference        TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'ended')),
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_prepaid_months_ordered CHECK (last_month >= first_month),
  CONSTRAINT mcp_prepaid_first_month_is_access_start
    CHECK (first_month = date_trunc('month', access_starts_on)::date),
  CONSTRAINT mcp_prepaid_last_month_matches_access_end
    CHECK (access_ends_on >= (last_month + INTERVAL '1 month')::date
       AND access_ends_on <  (last_month + INTERVAL '2 months')::date)
);

-- One live schedule per account; a second purchase extends or replaces this row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_prepaid_entitlements_active_user
  ON mcp_prepaid_entitlements (user_email) WHERE status = 'active';

ALTER TABLE mcp_prepaid_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_prepaid_entitlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_prepaid_entitlements_service ON mcp_prepaid_entitlements;
CREATE POLICY mcp_prepaid_entitlements_service ON mcp_prepaid_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON mcp_prepaid_entitlements FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
