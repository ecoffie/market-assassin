-- Ops-alert dedup state: one row per CHECK, holding a fingerprint of the finding set.
--
-- WHY: every ops check fires on `findings.length > 0` with no memory, so a real but
-- non-urgent condition re-alerts on every run forever. See lib/ops-alert-dedup.ts.
--
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS ops_alert_state (
  alert_key    text PRIMARY KEY,
  fingerprint  text,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops_alert_state IS
  'Dedup state for ops alerts. One row per check; an unchanged fingerprint stays silent until REMIND_AFTER_HOURS.';
COMMENT ON COLUMN ops_alert_state.fingerprint IS
  'Hash of WHICH items are affected. A change means genuinely new information, so the alert fires again.';
