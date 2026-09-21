-- Forecast bureau provenance — additive, nullable, NO data rewrite.
--
-- WHY (audited 2026-09-14): FCO has REMOVED organisational attribution from rows that still exist
-- upstream. Fish & Wildlife 710, Forest Service 639, PBS 28, NPS 14 — all still present upstream,
-- all with `Funding Organization` now blank. A canonical refresh that wrote the current NULL over
-- the held value would destroy valid source evidence that cannot be re-acquired.
--
-- So the canonical row must be able to say WHICH kind of value it holds:
--   'current'     the currently observed upstream source explicitly provides this bureau
--   'last_known'  the upstream row still exists, the source now publishes NULL, and we are
--                 preserving an EXACT previously observed source-native value
--   NULL          no defensible provenance classification
--
-- This keeps runtime on ONE table: Maps / MCP / /api/forecasts / saved-search alerts read
-- `agency_forecasts` and never join the retired duplicate `api` rows.
--
-- ⚠️ `bureau_observed_at` is the SOURCE observation time, never a Mindy write time. For rows whose
-- only timestamps are our own sync clock (the duplicate api rows carry no raw_data and only a
-- 2026-06-26 write stamp), it stays NULL. A fabricated timestamp would be worse than none.

ALTER TABLE agency_forecasts
  ADD COLUMN IF NOT EXISTS bureau_provenance  text,
  ADD COLUMN IF NOT EXISTS bureau_observed_at timestamptz;

-- Only the three approved states. No extra states in this pass.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agency_forecasts_bureau_provenance_check'
  ) THEN
    ALTER TABLE agency_forecasts
      ADD CONSTRAINT agency_forecasts_bureau_provenance_check
      CHECK (bureau_provenance IS NULL OR bureau_provenance IN ('current', 'last_known'));
  END IF;
END $$;

COMMENT ON COLUMN agency_forecasts.bureau_provenance IS
  'How `bureau` was obtained: current = source publishes it now; last_known = source blanked it, exact prior source-native value preserved; NULL = no defensible classification. Never infer from title/description/location.';
COMMENT ON COLUMN agency_forecasts.bureau_observed_at IS
  'When the bureau value was observed AT SOURCE. NULL when no defensible source observation timestamp exists — never substitute migration/write time or now().';

-- Partial index: the carry-forward rows are the ones reports and audits single out.
CREATE INDEX IF NOT EXISTS idx_agency_forecasts_bureau_provenance
  ON agency_forecasts (bureau_provenance)
  WHERE bureau_provenance IS NOT NULL;
