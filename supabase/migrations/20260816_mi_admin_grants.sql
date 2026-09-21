-- The Command Center's support-grant audit table.
--
-- WHY THIS EXISTS AS A MIGRATION: `applyMemberGrant` calls
-- `ensureGrantsAuditSchema()`, which tries to CREATE this table at runtime via
-- `supabase.rpc('exec_migration', ...)`. That RPC DOES NOT EXIST in this
-- database (verified: `SELECT proname FROM pg_proc WHERE proname='exec_migration'`
-- returns zero rows). So the bootstrap silently failed, the table was never
-- created, and every `recordGrant()` insert errored into a swallowed catch.
--
-- Net effect before this migration: EVERY support grant was unaudited. There was
-- no record of who granted what to whom — `access_grants` held only the 7
-- Stripe-webhook rows, and `mi_admin_grants` did not exist at all. Support has
-- been granting access since the Command Center shipped with zero trace.
--
-- Runtime DDL through a missing RPC is not a fallback, it is a silent no-op.
-- The table is created here, once, through the migration runner.
--
-- Columns match `recordGrant()` in src/lib/admin/member-grants.ts exactly, and
-- INCLUDE the two provenance columns (`grant_source`, `note`) that
-- `ensureGrantProvenanceColumns()` would otherwise try to add at runtime — so
-- both bootstrap functions become fast-path no-ops after this runs.

CREATE TABLE IF NOT EXISTS mi_admin_grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_email TEXT NOT NULL,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  tier         TEXT NOT NULL,
  sent_welcome BOOLEAN NOT NULL DEFAULT FALSE,
  grant_source TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent even if a partial table already exists in some environment.
ALTER TABLE mi_admin_grants ADD COLUMN IF NOT EXISTS grant_source TEXT;
ALTER TABLE mi_admin_grants ADD COLUMN IF NOT EXISTS note TEXT;

-- "What did support do lately?" — the audit list in MemberAccessSection.
CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_created
  ON mi_admin_grants (created_at DESC);

-- "What happened to THIS customer?" — the per-email history a support rep needs
-- when someone calls back about access.
CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_target
  ON mi_admin_grants (target_email);

-- Service-role only: this is an internal audit trail, never client-readable.
ALTER TABLE mi_admin_grants ENABLE ROW LEVEL SECURITY;
