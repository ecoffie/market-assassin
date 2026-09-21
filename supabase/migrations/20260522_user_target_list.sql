-- User Target List + Outreach log
--
-- Slice 3 of the Target Market Research roadmap. Lets users save
-- specific offices from the agency table (see Slice 1.5C/D) into a
-- persistent list they actually work over 12-18 months, and log
-- their BD outreach against each.
--
-- Naming follows the Mindy vocabulary rule (memory:
-- mindy-vocabulary-rule): "user_target_list" / "user_target_outreach"
-- — what BD people actually say. Not "user_target_accounts" /
-- "_activities" which is SaaS sales jargon.
--
-- Both tables include workspace_id so saved targets are visible to
-- the user's team in Team Access tier. Same pattern as user_pipeline.

-- ---------------------------------------------------------------------
-- 1) user_target_list — the saved offices
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_target_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT,
  user_email TEXT NOT NULL,

  -- Agency hierarchy (matches the AgencyTableRow shape from
  -- /api/app/target-market-research). Office is the leaf.
  agency_code TEXT,
  agency_name TEXT NOT NULL,         -- "Department of Defense"
  sub_agency_code TEXT,
  sub_agency_name TEXT,              -- "Department of the Air Force"
  office_code TEXT,                  -- "BP01" — leaf node ID
  office_name TEXT NOT NULL,         -- "Headquarters, EUSA"
  location TEXT,

  -- Snapshot of the signals at add-time so the list survives even
  -- if the source data shifts. Refreshed when the user opens the
  -- row from My Target List view.
  set_aside_spending NUMERIC DEFAULT 0,
  contract_count INT DEFAULT 0,
  sat_ratio NUMERIC DEFAULT 0,
  pain_point_count INT DEFAULT 0,
  open_opp_count INT DEFAULT 0,
  upcoming_event_count INT DEFAULT 0,

  -- BD workflow state
  status TEXT DEFAULT 'targeting',   -- targeting / contacted / qualified / passed / won
  priority TEXT DEFAULT 'medium',    -- low / medium / high / critical
  notes TEXT,

  added_from TEXT,                   -- 'research_drawer' / 'agency_table' / 'manual'
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Uniqueness: a user can't save the same office twice. The pair
  -- (user_email, office_name) is the dedupe handle since office_code
  -- can be missing for some USAspending rows.
  CONSTRAINT unique_user_target_office UNIQUE (user_email, office_name)
);

CREATE INDEX IF NOT EXISTS idx_user_target_list_user
  ON user_target_list (user_email, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_target_list_workspace
  ON user_target_list (workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_target_list_status
  ON user_target_list (user_email, status);

-- ---------------------------------------------------------------------
-- 2) user_target_outreach — activity log per target
-- ---------------------------------------------------------------------
-- One row per BD action a user takes toward an office on their target
-- list: email, call, event attended, RFI response, meeting, note.
--
-- Slice 3D wires the UI. Schema lands now so it's not blocking.
CREATE TABLE IF NOT EXISTS user_target_outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES user_target_list(id) ON DELETE CASCADE,
  workspace_id TEXT,
  user_email TEXT NOT NULL,

  activity_type TEXT NOT NULL,       -- email / call / event / rfi / meeting / note
  contact_name TEXT,
  contact_role TEXT,                 -- OSBP / Contracting Officer / SBA Liaison / etc.
  subject TEXT,
  body TEXT,
  outcome TEXT,                      -- replied / meeting_set / no_response / pass
  follow_up_date DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_target_outreach_target
  ON user_target_outreach (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_target_outreach_user
  ON user_target_outreach (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_target_outreach_followup
  ON user_target_outreach (user_email, follow_up_date)
  WHERE follow_up_date IS NOT NULL;

COMMENT ON TABLE user_target_list IS
  'Saved BD targets per user. Powered by Slice 3 of the Target Market Research roadmap (tasks/target-market-research-roadmap.md). User saves offices from the agency table; uses status + priority + notes to plan multi-month outreach.';

COMMENT ON TABLE user_target_outreach IS
  'Activity log per target. Each row is one BD action: email, call, event attended, RFI response, meeting, or freeform note. Joins to user_target_list via target_id.';

NOTIFY pgrst, 'reload schema';
