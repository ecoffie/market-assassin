-- Pursuit Work Model (Eric 2026-08-06): "Work → Next Action → Agenda".
-- Pursuits is a daily WORK manager, not a CRM pipeline. The structured next-action is the
-- foundation the whole page derives from (Today's Priorities, Waiting on You, Due This Week,
-- proposal-section routing, team workload, morning briefing) — NOT a one-off agenda feature.
--
-- REUSES existing columns (do NOT re-add): next_action TEXT, next_action_date DATE, owner_email,
-- priority. This migration adds ONLY the two genuinely-missing fields for the work model.
--
-- Idempotent (IF NOT EXISTS) — safe to run more than once.

-- The WORK CATEGORY — the actual stages of federal BD, not arbitrary task verbs.
-- Capture · Research · Customer · Proposal · Pricing · Compliance · Submission · Other.
-- This is what makes "how much time do teams spend in Capture?" answerable, and what lets a
-- Proposal-category next-action route into the Proposal Workspace on the right section.
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS work_category TEXT;
COMMENT ON COLUMN user_pipeline.work_category IS
  'Work-model category for the current next action: capture, research, customer, proposal, pricing, compliance, submission, other. Drives Today''s Priorities, section routing, workload analytics.';

-- NEEDS ME TODAY — the WHOLE priority system (Eric: not High/Med/Low — just "needs me today" yes/no).
-- A pursuit flagged true floats to the top of Today's Priorities.
ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS needs_me_today BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN user_pipeline.needs_me_today IS
  'The priority flag (Eric: replaces High/Med/Low). true = surface in Today''s Priorities today.';

-- Index the two fields Today's Priorities filters/sorts on most.
CREATE INDEX IF NOT EXISTS idx_pipeline_work_category ON user_pipeline(work_category);
CREATE INDEX IF NOT EXISTS idx_pipeline_needs_me_today ON user_pipeline(needs_me_today) WHERE needs_me_today = true;
