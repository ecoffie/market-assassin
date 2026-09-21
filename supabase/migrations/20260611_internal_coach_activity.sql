-- Coach activity CRM (MI-INTERNAL-COMMAND-CENTER-PRD §8, COACH-ENTERPRISE-BD-PLAN).
-- Ryan, Zach, Randie, Tavin log partner BD + customer-success signals here.
-- Hand-run in Supabase SQL editor, then NOTIFY pgrst.

CREATE TABLE IF NOT EXISTS internal_coach_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach         TEXT NOT NULL,           -- Ryan | Zach | Randie | Tavin
  activity_type TEXT NOT NULL,           -- partner_bd | livestream_validation | …
  target_name   TEXT,
  target_org    TEXT,
  target_email  TEXT,
  channel       TEXT,                    -- call | email | event | livestream | referral
  segment       TEXT,
  objective     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  customer_signal TEXT,                -- what we learned from the conversation
  notes         TEXT,
  next_action   TEXT,
  escalation_needed BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS internal_coach_activity_coach_idx
  ON internal_coach_activity (coach, status);
CREATE INDEX IF NOT EXISTS internal_coach_activity_type_idx
  ON internal_coach_activity (activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS internal_coach_activity_status_idx
  ON internal_coach_activity (status, updated_at DESC);

CREATE OR REPLACE FUNCTION internal_coach_activity_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS internal_coach_activity_updated_at ON internal_coach_activity;
CREATE TRIGGER internal_coach_activity_updated_at
  BEFORE UPDATE ON internal_coach_activity
  FOR EACH ROW EXECUTE FUNCTION internal_coach_activity_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE internal_coach_activity IS
  'Coach Signal Loop queue — partner BD, proof stories, referrals. NOT profile nudges (those are Annelle/Sikander). See tasks/COACH-ENTERPRISE-BD-PLAN.md.';
