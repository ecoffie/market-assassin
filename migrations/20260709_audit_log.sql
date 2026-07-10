-- Audit log ("CloudTrail" equivalent) — who did what, when.
-- Records sensitive admin/security actions in a queryable table instead of
-- console.log-only. Hand-run in Supabase SQL Editor (this DB has no in-app DDL).
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email   TEXT,                 -- who performed the action (admin identity; 'admin' until per-user admin ships in P3)
  actor_ip      TEXT,                 -- source IP (x-forwarded-for)
  action        TEXT NOT NULL,        -- e.g. 'grant_ma_access', 'revoke_access', 'tier_change'
  target_email  TEXT,                 -- the user the action was performed ON (if any)
  target_table  TEXT,                 -- table/resource affected (if any)
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- action-specific payload (never store secrets/tokens in full)
  user_agent    TEXT,                 -- requesting client UA
  request_id    TEXT                  -- correlation id if available
);

-- Query patterns: recent-first, by actor, by target, by action.
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at   ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action       ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_email ON audit_log (target_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email  ON audit_log (actor_email);

-- RLS: enable it and allow ONLY the service role (server writes/reads).
-- No anon/authenticated policy → clients can never read the audit trail.
-- (This table is a good first candidate for the P4 RLS rollout.)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_log' AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access ON audit_log
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
