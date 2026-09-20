-- INSTITUTE LEGISLATION — admit committee reports as first-class evidence.
--
-- WHY: the 20260913 CHECK already anticipated legislative sources
-- ('introduced_bill', 'enacted_law', 'appropriation', 'ndaa_provision') but has no
-- value for COMMITTEE REPORT LANGUAGE. That is not a rounding error in the taxonomy —
-- report language (H. Rept. 119-698 / S. Rept. 119-127) is where congressional
-- direction to an agency actually lives, and it routinely carries guidance that never
-- appears in bill text at all.
--
-- The alternative — filing reports under 'introduced_bill' — would have collapsed two
-- genuinely different artifacts into one type, which is the exact failure this whole
-- workstream exists to prevent. Verified live 2026-09-18 that the pre-change
-- constraint REJECTS 'committee_report'.
--
-- Conference reports are NOT a separate type: they are committee reports carrying
-- isConferenceReport=true, preserved in raw + in the title. The API states that fact
-- itself, so we record it rather than inferring it from a citation string.
--
-- Idempotent + non-destructive: widens an allowed set, rewrites no rows.

ALTER TABLE institute_sources DROP CONSTRAINT IF EXISTS institute_sources_source_type_check;

ALTER TABLE institute_sources ADD CONSTRAINT institute_sources_source_type_check
  CHECK (source_type IN (
    'gao_report','ig_report','crs_report','enacted_law','introduced_bill',
    'appropriation','ndaa_provision','federal_register','budget_justification',
    'strategic_plan','procurement_forecast','executive_directive',
    'committee_report'
  ));

-- Legislative lookups are by (congress, bill) far more often than by agency, and the
-- existing indexes are agency/date/org-keyed only.
CREATE INDEX IF NOT EXISTS idx_institute_sources_legislative
  ON institute_sources (source_type, publication_date DESC)
  WHERE source_type IN ('introduced_bill','enacted_law','committee_report','appropriation','ndaa_provision');
