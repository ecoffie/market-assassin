-- SAM status reconciliation audit (2026-11-10). Idempotent.
-- One row per decision the reconcile step makes after a fully completed full sync:
-- decision = 'deactivate' (rule R2/R3 with evidence) or 'held' (left unchanged, with reason).
-- applied = true only for rows the CAS update actually flipped — that is the rollback record:
--   update sam_opportunities set active = true
--   where id in (select opp_id from sam_status_decisions where run_id = '<run>' and applied)
--     and active = false;

CREATE TABLE IF NOT EXISTS sam_status_decisions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL,
  opp_id UUID NOT NULL,
  notice_id TEXT NOT NULL,
  mode TEXT NOT NULL,            -- report | apply
  decision TEXT NOT NULL,        -- deactivate | held
  rule TEXT,                     -- R2_absent_archive_passed | R3_absent_superseded
  hold_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sam_status_decisions_run_idx ON sam_status_decisions (run_id, applied);
CREATE INDEX IF NOT EXISTS sam_status_decisions_notice_idx ON sam_status_decisions (notice_id, decided_at DESC);

ALTER TABLE sam_status_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sam_status_decisions' AND policyname = 'Service role full access sam_status_decisions') THEN
    CREATE POLICY "Service role full access sam_status_decisions" ON sam_status_decisions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Per-run summary (counts by rule / hold reason, samples, mode, cap) next to the run it describes.
ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS status_reconcile JSONB;

COMMENT ON TABLE sam_status_decisions IS 'Audit + rollback record for SAM status reconciliation (R2 archive passed / R3 superseded / held).';
