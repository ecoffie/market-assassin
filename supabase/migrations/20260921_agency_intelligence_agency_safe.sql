-- Option C — quarantine unsupported agency attribution from AGENCY-SPECIFIC reads.
--
-- Product disposition (approved 2026-09-20), applied to the evidence classes from
-- `agency_intelligence_attribution`:
--
--   artifact_agency        148  → EXCLUDED from agency-specific customer reads
--   unsupported_by_title    64  → EXCLUDED from agency-specific customer reads
--   no_title_evidence      211  → RETAINED, but never presented as corroborated
--   corroborated_by_title   22  → retained normally
--                          ---
--                          445
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
-- No row is deleted, rewritten or re-attributed. `agency_intelligence` is
-- untouched and remains the complete historical record. This is a READ boundary:
-- the same rows simply stop being reachable through an AGENCY-SPECIFIC lookup,
-- because that is the only context in which a wrong agency is a false claim.
--
-- Non-agency-specific surfaces (admin inventory, data-health counters, research
-- over the historical corpus) continue to read the base table directly and still
-- see all 445 rows. Suppressing the corpus globally would destroy evidence to fix
-- a presentation defect.
--
-- ── WHY no_title_evidence IS KEPT ──────────────────────────────────────────
-- 211 rows (47%) carry no agency-shaped title prefix, so the title cannot
-- adjudicate their attribution either way. Excluding them would assert they are
-- wrong; promoting them would assert they are right. Both are guesses. They stay
-- visible and carry their evidence class so the display can say "unresolved".

CREATE OR REPLACE VIEW public.agency_intelligence_agency_safe AS
SELECT
  ai.*,
  -- NULL for every non-GAO row (contract_pattern etc.), which the attribution
  -- view does not classify and this boundary does not gate.
  att.attribution_evidence
FROM public.agency_intelligence ai
LEFT JOIN public.agency_intelligence_attribution att ON att.id = ai.id
WHERE
  -- Rows outside the GAO corpus are unaffected by this quarantine.
  ai.intelligence_type <> 'gao_high_risk'
  -- GAO rows pass only when the evidence does not contradict the stored agency.
  OR att.attribution_evidence IN ('corroborated_by_title', 'no_title_evidence');

COMMENT ON VIEW public.agency_intelligence_agency_safe IS
  'AGENCY-SPECIFIC customer read boundary for agency_intelligence. Excludes GAO rows classified artifact_agency or unsupported_by_title (212 of 445). Deletes nothing — agency_intelligence keeps all 445 rows and non-agency-specific surfaces still read it directly. Rows carry attribution_evidence so no_title_evidence is never displayed as corroborated.';
