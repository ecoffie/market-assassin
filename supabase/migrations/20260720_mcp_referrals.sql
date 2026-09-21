-- MCP Referral Program (2026-07-20) — double-sided 100-credit referral.
-- Referrer and referred each get 100 MCP credits when the REFERRED user completes their
-- first VERIFIED authenticated session (app OAuth/MFA or MCP OAuth). Anti-abuse: one reward
-- per referred identity (UNIQUE referred_email), self-referral blocked in app code, a
-- per-referrer cap (MCP_REFERRAL_CAP, default 25), and grants routed through the atomic
-- mcp_grant_credits ledger with reason 'referral'. Idempotent + reversible.

-- Each user's stable referral code → owner email. Code is what a friend carries as ?ref=<code>.
CREATE TABLE IF NOT EXISTS mcp_referral_codes (
  code         TEXT PRIMARY KEY,
  owner_email  TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_referral_codes_owner ON mcp_referral_codes (owner_email);

-- One row per referred person. UNIQUE(referred_email) is the core anti-farm guard:
-- a given friend can only ever mint ONE referral reward, no matter how many links they click.
CREATE TABLE IF NOT EXISTS mcp_referrals (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_email  TEXT NOT NULL,
  referred_email  TEXT NOT NULL UNIQUE,
  ref_code        TEXT NOT NULL,
  -- pending  = friend arrived via a link, not yet verified-signed-in
  -- granted  = friend completed a verified session; both sides credited
  -- rejected = failed a guard (self-referral / referrer over cap / referred already had a balance)
  status          TEXT NOT NULL DEFAULT 'pending',
  credits         INT  NOT NULL DEFAULT 0,
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at    TIMESTAMPTZ,
  granted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mcp_referrals_referrer ON mcp_referrals (referrer_email);
CREATE INDEX IF NOT EXISTS idx_mcp_referrals_status   ON mcp_referrals (status);

-- RLS: service-role only, matching every other mcp_* table (no client access).
ALTER TABLE mcp_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_referrals      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mcp_referral_codes' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON mcp_referral_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mcp_referrals' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON mcp_referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
