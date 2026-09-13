-- Organization MCP credit pool + ledger actor/payer provenance.
--
-- PR 2 of the Teams shared-MCP sequence. ADDITIVE AND INERT: creates one empty table
-- and adds two nullable columns. NO code reads or writes either yet. Debit behaviour,
-- grant behaviour, Team allowance (still 1,000) and customer-facing copy are all
-- unchanged by this migration.
--
-- ── THE PROVENANCE PROBLEM THIS SOLVES ───────────────────────────────────────
-- `mcp_credit_ledger.user_email` today conflates two different facts: WHO performed
-- the call and WHOSE balance paid for it. On a personal balance they are the same
-- person, so the conflation is invisible. The moment an organization pool pays for a
-- member's call they diverge, and a ledger that cannot separate them cannot answer
-- "who spent our team's credits?" — the first question any Team admin will ask.
--
-- So the columns are added BEFORE any pooled spending exists. Adding them afterwards
-- would leave a window of rows that can never be attributed.
--
-- ── ACTOR IDENTITY: WHY actor_email AND NOT actor_user_id (settled, not deferred) ──
-- `docs/PRD-identity-model.md` makes `auth.users.id` the canonical account key, so
-- actor_user_id UUID is the correct long-term column. It is NOT added yet because MCP
-- cannot reliably resolve it today. Traced 2026-09-08:
--   • `VerifiedApiKey` (src/lib/mcp/api-keys.ts:37) carries `userEmail` only — no id.
--   • OAuth `AccessTokenClaims.sub` (src/lib/mcp/oauth/tokens.ts:58) is *the user's
--     email*, not a UUID.
--   • So every MCP entry point knows an email and nothing else. Deriving a UUID would
--     mean a lookup that can MISS: measured, 53 existing ledger rows have a
--     user_email with no resolvable `user_profiles.user_id`.
-- Writing a nullable actor_user_id we cannot populate would create a column that is
-- silently empty on the paths that matter — the "unknown rendered as absent" failure
-- this codebase has been bitten by. Email is what MCP actually knows, so email is what
-- it records.
--
-- MIGRATION PATH TO CANONICAL ID (recorded so this does not become permanent debt):
--   1. MCP auth resolves and carries `auth.users.id` (identity-model P1 work).
--   2. `ALTER TABLE mcp_credit_ledger ADD COLUMN actor_user_id UUID` (nullable).
--   3. Dual-write both columns; backfill historical rows where email resolves,
--      leaving the unresolvable ones NULL and COUNTED, never guessed.
--   4. Cut reads to actor_user_id; keep actor_email as a display snapshot.
-- actor_email is deliberately a SNAPSHOT — the address as it was at spend time — so
-- the ledger stays truthful even after someone changes their email.

-- ── THE POOL ─────────────────────────────────────────────────────────────────
-- Mirrors `mcp_credit_balance` exactly (same CHECK, same atomic-update shape) so the
-- existing `UPDATE … WHERE balance >= amount RETURNING` debit pattern transfers
-- unchanged. It becomes a hotter row (N seats contending vs 1); Postgres row-locking
-- already handles that — no new concurrency mechanism is introduced.
CREATE TABLE IF NOT EXISTS mcp_credit_pool (
  pool_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: an organization owns AT MOST ONE pool. Two pools for one org would make
  -- "the team's balance" ambiguous and let a debit silently drain the wrong one.
  org_id     UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE RESTRICT, not CASCADE: deleting an organization that still owns credits
-- must fail loudly rather than silently destroying a paid balance.

COMMENT ON TABLE mcp_credit_pool IS
  'Shared MCP balance owned by an organization. One pool per org (UNIQUE org_id). Personal balances stay in mcp_credit_balance and are never migrated here.';
COMMENT ON COLUMN mcp_credit_pool.org_id IS
  'Owning organization. UNIQUE — an org has at most one pool.';

-- ── PROVENANCE ON THE LEDGER ─────────────────────────────────────────────────
-- Both nullable, so every one of the 5,833 existing rows stays valid untouched.
ALTER TABLE mcp_credit_ledger
  ADD COLUMN IF NOT EXISTS actor_email TEXT;

ALTER TABLE mcp_credit_ledger
  ADD COLUMN IF NOT EXISTS charged_pool_id UUID REFERENCES mcp_credit_pool(pool_id);

-- charged_pool_id NULL is MEANINGFUL, not missing: it means "this was the personal
-- path", which is every historical row and every personal call from here on. The
-- distinction personal-vs-org is therefore readable directly off the ledger, which is
-- one of the PR 2 acceptance criteria.
COMMENT ON COLUMN mcp_credit_ledger.actor_email IS
  'WHO performed the call, snapshotted at spend time. NULL on historical rows (pre-provenance). Migration path to actor_user_id is recorded in 20260908_mcp_credit_pool.sql.';
COMMENT ON COLUMN mcp_credit_ledger.charged_pool_id IS
  'WHOSE balance paid. NULL = personal balance (mcp_credit_balance) — meaningful, not missing. Non-NULL = that organization pool paid.';

-- Partial index: only pooled rows are worth indexing, and today there are none.
CREATE INDEX IF NOT EXISTS idx_mcp_ledger_charged_pool
  ON mcp_credit_ledger (charged_pool_id, created_at DESC)
  WHERE charged_pool_id IS NOT NULL;

-- Answers "what did this person spend?" across both personal and pooled rows.
CREATE INDEX IF NOT EXISTS idx_mcp_ledger_actor
  ON mcp_credit_ledger (actor_email, created_at DESC)
  WHERE actor_email IS NOT NULL;

-- RLS: service-role only, matching mcp_credit_balance / _ledger / mcp_call_log
-- exactly (20260712_mcp_credit_ledger.sql:105-113). FORCE matters — without it the
-- table owner bypasses RLS, so ENABLE alone would be a weaker guard than its
-- siblings on a table that holds paid balances.
ALTER TABLE mcp_credit_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_credit_pool FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_credit_pool_service ON mcp_credit_pool;
CREATE POLICY mcp_credit_pool_service ON mcp_credit_pool
  FOR ALL TO service_role USING (true) WITH CHECK (true);
