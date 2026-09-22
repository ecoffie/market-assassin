-- Legacy GAO attribution — EVIDENCE classification, not repair (Workstream A2).
--
-- ── THE DEFECT (measured 2026-09-20) ───────────────────────────────────────
-- `agency_intelligence` gao_high_risk: 445 rows, 271 distinct titles.
--   · 133 titles (49%) are filed under 2–4 DIFFERENT agencies → 307 of 445 rows
--   · 148 rows (33%) carry an agency name that is not an agency at all:
--       General Government (141) · Department of the (2) · Department of Health (2)
--       Department of Veterans (1) · for Agency (1) · Governing Agency (1)
--
-- Unambiguous examples:
--   "Department of Health and Human Services: Management Challenges…"
--       filed under HHS · Homeland Security · EPA · "Department of Health"
--   "General Services Administration: Building Security Upgrades…"
--       filed under GSA · Commerce · Homeland Security · SEC
--
-- Potato-0C repaired ONE report and its 50 cached opportunities. The CLASS is
-- still live. The P0 taught the same lesson: fix the pattern, not the instance.
--
-- ── WHY THIS MIGRATION DOES NOT REPAIR ─────────────────────────────────────
-- `agency_intelligence` is keyed UNIQUE(agency_name, type, title), so correcting
-- `agency_name` REWRITES the primary identity of the row and can collide with an
-- existing row for the same document. There are several defensible dispositions
-- (rewrite and merge · add a resolved column and leave the stored value · move
-- unsupported rows to a quarantine), and choosing among them is a product
-- decision, not something a migration should settle silently.
--
-- So this adds EVIDENCE ONLY. Every row keeps its stored agency; the view states
-- whether the title supports it. Ambiguity is preserved explicitly:
-- `unsupported` means "the title does not corroborate this agency", NOT "this
-- agency is wrong" — a GAO report may legitimately cover several agencies, and
-- 344 of 445 rows carry no agency-shaped title prefix at all, so for them the
-- correct answer is `no_title_evidence`, never a guess.

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
)
SELECT
  f.id,
  f.source_document_id,
  f.agency_name,
  f.title_prefix,
  f.title,
  f.source_url,
  f.rows_for_document,
  f.agencies_for_document,
  f.stored_agency_is_artifact,
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
FROM f;

COMMENT ON VIEW public.agency_intelligence_attribution IS
  'Evidence classification for legacy GAO agency attribution. Repairs NOTHING: every row keeps its stored agency. unsupported_by_title means the title does not corroborate the stored agency, NOT that the agency is wrong — a GAO report may legitimately cover several agencies. Rows with no agency-shaped title prefix are no_title_evidence, never a guess.';
