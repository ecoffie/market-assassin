-- ============================================================================
-- MCP API keys  (2026-07-12)  — Mindy MCP Server, Phase 1 Slice 1 (Foundation)
--
-- WHY: The hosted Mindy MCP server (mcp.getmindy.ai) authenticates each agent
-- call with a per-user API key drawn from the user's prepaid credit balance.
-- This table stores those keys. We store ONLY a SHA-256 hash of the key + a short
-- display prefix — the full secret is shown to the user exactly ONCE at creation
-- and is never recoverable, so a DB read (or leak) cannot reveal a working key.
--
-- THREAT MODEL (mirrors the vault-RLS backstop convention):
--   * Every server path touches this table via the SERVICE_ROLE key, which
--     BYPASSES RLS — so enabling RLS does NOT break the app.
--   * Key owners are EMAIL-ONLY Mindy users (MI 2FA token, no auth.users row), so
--     an auth.uid()-scoped policy would match nobody. The correct backstop is
--     DENY-by-default for anon/authenticated; only service_role reads/writes.
--   * key_hash is UNIQUE so a verification lookup is a single indexed equality.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,          -- sha256(plaintext key), hex
  key_prefix    TEXT NOT NULL,                 -- e.g. "mcp_live_a1b2c3" — display only
  scopes        TEXT[] NOT NULL DEFAULT '{}',  -- reserved for per-key tool scoping (Phase 2)
  label         TEXT,                          -- optional user-facing name ("Claude Desktop")
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ                    -- non-null => revoked, rejected at verify time
);

-- Verification hot path: lookup by hash, only non-revoked.
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash ON mcp_api_keys (key_hash) WHERE revoked_at IS NULL;
-- Dashboard list path: a user's keys, newest first.
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user ON mcp_api_keys (user_email, created_at DESC);

-- RLS backstop: deny anon/authenticated entirely; service_role (app) bypasses RLS.
ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_api_keys_service_role_all ON mcp_api_keys;
CREATE POLICY mcp_api_keys_service_role_all ON mcp_api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON mcp_api_keys FROM anon, authenticated, PUBLIC;
