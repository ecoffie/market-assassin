-- Target list provenance — remember which NAICS / PSC surfaced a saved office
--
-- Slice 5b (item #3) of the Target Market Research roadmap
-- (tasks/target-market-research-roadmap.md):
--
--   "store the PSC code that surfaced the target, not just NAICS. So a
--    user with 5 saved targets can see '3 surfaced from PSC D316, 2 from
--    NAICS 541512'."
--
-- Eric flagged PSC precision explicitly (May 22): NAICS 541512 is a
-- 50,000-company bucket; PSC D316 is ~500 companies. BD precision lives
-- at the PSC layer, so we record the exact codes the user was searching
-- when they saved the office.
--
-- Both columns are comma-joined TEXT (e.g. "541512, 541611") to match
-- how the Market Research search form holds them — keeps the read path
-- trivial and survives unchanged through GET select('*').
--
-- Additive + nullable + idempotent: zero risk to existing rows. Targets
-- saved before this migration simply carry NULL (no chip shown), which
-- is expected — provenance is captured going forward only.

ALTER TABLE user_target_list
  ADD COLUMN IF NOT EXISTS source_naics TEXT,  -- comma-joined NAICS from the surfacing search
  ADD COLUMN IF NOT EXISTS source_psc  TEXT;   -- comma-joined PSC from the surfacing search

COMMENT ON COLUMN user_target_list.source_naics IS
  'Comma-joined NAICS codes from the Market Research search that surfaced this target. NULL for targets saved before the provenance migration (2026-05-31).';
COMMENT ON COLUMN user_target_list.source_psc IS
  'Comma-joined PSC codes from the Market Research search that surfaced this target. PSC is the more precise classifier (roadmap Slice 5b). NULL when the user searched by NAICS only or for pre-migration targets.';

NOTIFY pgrst, 'reload schema';
