-- Decision-time instrumentation (#122) — the crown-jewel metric of the Mindy Procurement
-- Intelligence Report (docs/strategy/PRD-procurement-intelligence-report.md): median DAYS from a
-- contractor first DISCOVERING an opportunity to SAVING it (pursuit intent). It's the single most
-- defensible number in the report — no public source (SAM/GovWin/GovTribe) can produce it, and it
-- is the ONE metric that cannot be backfilled: unless we stamp it while the save happens, that
-- history is gone forever. So we capture it now.
--
-- WHY a stamped column, NOT a cross-table join (memory: decision_time_notice_id_mismatch):
--   user_pipeline.notice_id is a SAM 32-char hex UUID; the map's listing_open view events logged
--   FORECAST fc- ids — 0 (user,notice) pairs matched across a join. Joining is fragile and lossy.
--   Instead, at SAVE time we already know (user, notice), so we resolve discovered_at ONCE and
--   FREEZE it on the row: the user's earliest logged view of that notice if one exists, else NOW()
--   as an honest floor (a same-visit save = 0 decision-days — the metric can only UNDERstate, never
--   fabricate). decision_time = created_at − discovered_at, reliable forward, no join.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No backfill of existing rows (their true discovery moment
-- is unknowable — leaving them NULL is honest; the metric measures forward from this migration).

ALTER TABLE user_pipeline
  ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

COMMENT ON COLUMN user_pipeline.discovered_at IS
  'When the user first discovered this opportunity (earliest logged view, else the save moment as a floor). Frozen at save time. decision_time = created_at - discovered_at. NULL on rows saved before 20260807 (true discovery unknowable — never fabricated).';
