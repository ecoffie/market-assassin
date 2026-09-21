-- Workstream E — PERMANENT DISPOSITION for the 212 quarantined legacy GAO rows.
--
-- This migration REPAIRS NOTHING and MUTATES NOTHING. It records, in the database,
-- the conclusion of the repairability investigation so that a future session cannot
-- reasonably re-derive it — and cannot mistake "not yet repaired" for "repairable".
--
-- ── THE QUESTION ASKED ─────────────────────────────────────────────────────
-- Does a DETERMINISTIC repair exist for the 212 GAO rows excluded from
-- agency-specific customer reads by `agency_intelligence_agency_safe`
-- (148 artifact_agency + 64 unsupported_by_title)?
--
-- A repair is deterministic only if a HELD source field names the AGENCY UNDER
-- REVIEW. Title text is not source evidence — it is the very thing the legacy
-- writer mistook for evidence.
--
-- ── ROOT CAUSE (measured, not inferred) ────────────────────────────────────
-- `src/lib/agency-intelligence/fetchers/govinfo.ts` never read an agency field at
-- all. `extractAgenciesFromTitle()` substring-matches the report TITLE against a
-- 189-entry TOPIC→agency map, pushes one row per keyword hit, and when nothing
-- matches writes the literal placeholder 'General Government'. Two regex patterns
-- -- /Department of (\w+)/ and /(\w+) Agency/ -- capture fragments off GovInfo's
-- own TRUNCATED titles, producing the six non-agency strings:
--   General Government (141) · Department of the (2) · Department of Health (2)
--   Department of Veterans (1) · for Agency (1) · Governing Agency (1)
--
-- So `agency_name` on this corpus is a DERIVED ARTIFACT of title text, never an
-- observation. Replaying that function over the stored titles reproduces the
-- stored agency set exactly for 183 of 271 documents (67.5%); the 88 mismatches
-- store 'General Government' ALONGSIDE real agencies, which the current code
-- cannot even emit — i.e. the values were produced by a now-unreproducible
-- earlier revision. There is no recoverable provenance to restore.
--
-- ── BOTH CANDIDATE EVIDENCE HOLDERS TESTED, BOTH EMPTY ─────────────────────
-- (a) `institute_sources` — the canonical document corpus, which DOES carry
--     provenance. Holds 49 gao_report rows, publication window 2026-07-22 ..
--     2026-09-18. This corpus is published 1993-10-06 .. 2000-09-27. Overlap by
--     document_number: 0. By title: 0. It cannot adjudicate a single row.
--
-- (b) The GovInfo package record each row ALREADY CITES. Read read-only for 45 of
--     the 179 candidate documents. The ONLY agency-shaped fields are:
--         governmentAuthor1 = 'Government Accountability Office'  (1 distinct
--                             value across every record — the PUBLISHER)
--         governmentAuthor2 = GAO's OWN internal division, 6 distinct values
--                             ('General Government Division', 'Accounting and
--                             Information Management Division', ...)
--     Records naming an agency UNDER REVIEW in any agency-shaped field: 0 of 45.
--     The subject agency exists only in the report's body prose. Extracting it
--     would be inference over unheld text, not source proof — and the GovInfo
--     GAOREPORTS writer is itself quarantined as non-authoritative (frozen
--     collection, 2026-09-17), so it may not become an attribution authority.
--
-- ── FOUR-WAY CLASSIFICATION (212 rows, denominator 445 gao_high_risk) ───────
--   SOURCE-PROVEN         0   <- nothing is eligible for automatic correction
--   TITLE-CORROBORATED    0   <- the 22 corroborated rows are NOT in this set;
--                                they were never quarantined
--   AMBIGUOUS           130   <- 64 unsupported_by_title + 66 artifact_agency
--   NO EVIDENCE          82   <- artifact_agency, title names no agency, no
--                                competing attribution on the document
--
-- ── DISPOSITION: PRESERVED HISTORICAL SOURCE ERROR ─────────────────────────
-- No defensible repair exists. These 212 rows are retained, unmodified, as an
-- honest record of a historical ingest defect. They stay excluded from
-- agency-specific customer reads by the existing quarantine, which this
-- migration deliberately LEAVES UNTOUCHED.
--
-- Writing a "best guess" agency here would convert an ingest artifact into a
-- Mindy-asserted fact about a federal agency — the exact failure the claim
-- contract (`src/lib/strategic-intel/strategic-claims.ts`) exists to prevent.
-- Unknown is not zero, and a missing source field is not permission to guess.

-- Append `repairability` to the evidence view. CREATE OR REPLACE VIEW permits
-- appending columns at the end; every pre-existing column keeps its name, type
-- and ordinal position, so `agency_intelligence_agency_safe` (which reads only
-- `att.attribution_evidence`) is unaffected.
CREATE OR REPLACE VIEW public.agency_intelligence_attribution AS
WITH r AS (
  SELECT
    ai.id,
    ai.agency_name,
    ai.title,
    ai.source_url,
    -- The SOURCE-NATIVE document id. Identity is the document, never the title
    -- text and never a row count.
    regexp_replace(ai.source_url, '^.*/', '') AS source_document_id,
    btrim(split_part(ai.title, ':', 1))       AS title_prefix
  FROM public.agency_intelligence ai
  WHERE ai.intelligence_type = 'gao_high_risk'
),
doc_counts AS (
  SELECT r.source_document_id,
         count(*)                     AS rows_for_document,
         count(DISTINCT r.agency_name) AS agencies_for_document
  FROM r
  GROUP BY r.source_document_id
),
f AS (
  SELECT r.*,
    -- Does the title lead with something agency-shaped?
    (r.title_prefix ~* '^(department|u\.s\.|office of|national|federal|general services|social security|environmental|small business|nuclear|securities|internal revenue)')
      AS title_names_an_agency,
    -- Is the stored agency name a real agency, or a parse artifact?
    (r.agency_name IN ('General Government', 'Department of the', 'Department of Health',
                       'Department of Veterans', 'for Agency', 'Governing Agency'))
      AS stored_agency_is_artifact,
    -- Pre-aggregated per document. Postgres does NOT implement DISTINCT inside a
    -- window function (0A000), so the per-document fan-out is counted in a CTE
    -- and joined back rather than computed with count(DISTINCT ...) OVER (...).
    d.rows_for_document,
    d.agencies_for_document
  FROM r
  JOIN doc_counts d ON d.source_document_id = r.source_document_id
),
classified AS (
  SELECT f.*,
    CASE
      -- Not an agency at all. Deterministic: these six strings are artifacts.
      WHEN f.stored_agency_is_artifact                       THEN 'artifact_agency'
      -- The title names an agency and it is NOT the one stored.
      WHEN f.title_names_an_agency
           AND lower(f.title_prefix) <> lower(f.agency_name) THEN 'unsupported_by_title'
      -- The title names an agency and it matches.
      WHEN f.title_names_an_agency                           THEN 'corroborated_by_title'
      -- No agency-shaped prefix: the title cannot adjudicate. NOT a guess.
      ELSE 'no_title_evidence'
    END AS attribution_evidence
  FROM f
)
SELECT
  c.id,
  c.source_document_id,
  c.agency_name,
  c.title_prefix,
  c.title,
  c.source_url,
  c.rows_for_document,
  c.agencies_for_document,
  c.stored_agency_is_artifact,
  c.attribution_evidence,
  -- ── APPENDED: repairability, the Workstream E disposition ────────────────
  -- SOURCE-PROVEN is structurally unreachable for this corpus and is written as a
  -- literal absence rather than omitted, so the value set itself records that the
  -- class was tested and found empty. See the header for both holders tested.
  CASE
    WHEN c.attribution_evidence NOT IN ('artifact_agency', 'unsupported_by_title')
      THEN NULL  -- not quarantined; this column classifies only the 212
    WHEN c.title_names_an_agency OR c.agencies_for_document > 1
      THEN 'AMBIGUOUS'
    ELSE 'NO_EVIDENCE'
  END AS repairability
FROM classified c;

COMMENT ON VIEW public.agency_intelligence_attribution IS
  'Evidence classification for legacy GAO agency attribution. Repairs NOTHING: every row keeps its stored agency. unsupported_by_title means the title does not corroborate the stored agency, NOT that the agency is wrong. Rows with no agency-shaped title prefix are no_title_evidence, never a guess. `repairability` is the Workstream E permanent disposition for the 212 quarantined rows: SOURCE-PROVEN 0 (both holders tested empty — institute_sources has zero document overlap, and the cited GovInfo record names only GAO-as-publisher and GAO internal divisions, never the agency under review), AMBIGUOUS 130, NO_EVIDENCE 82. Disposition: PRESERVED HISTORICAL SOURCE ERROR. No automatic correction is permitted from held evidence.';
