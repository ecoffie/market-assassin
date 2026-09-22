# Option C — quarantine unsupported agency attribution (Workstream A, batch 2)

**Date:** 2026-09-21 · Product disposition approved 2026-09-20.
**No source row is deleted, rewritten or re-attributed.**

## The disposition

| Evidence class | Rows | Agency-specific customer reads |
|---|---:|---|
| `artifact_agency` | **148** | **EXCLUDED** |
| `unsupported_by_title` | **64** | **EXCLUDED** |
| `no_title_evidence` | **211** | retained — **never presented as corroborated** |
| `corroborated_by_title` | **22** | retained normally |
| **total** | **445** | **233 GAO rows reachable · 212 quarantined** |

## A1 — every customer read, traced

`gao_high_risk` reaches customers through exactly **two query authorities** — not one:

| Path | Kind | Disposition |
|---|---|---|
| `getAgencyIntelligence()` | agency-specific (canonical-exact) | → safe view |
| `getIntelligenceForBriefing()` | agency-specific (takes an agency list) | → safe view |
| `getUnifiedAgencyIntelligence()` → opp-intel · buyer-detail · understand-customer · MCP `get_agency_intel` · `/api/pain-points` | all funnel through `getAgencyIntelligence` | covered |
| `admin/data-inventory`, `admin/sync-agency-intel`, `data-core/advancement` | **not agency-specific** — counters and monitoring | unchanged, still read the base table |

`MyTargetListPanel` carries only a code *comment* naming the table; it fetches
the provenance-aware `/api/pain-points`.

## A2 — the boundary

`agency_intelligence_agency_safe` (view). A GAO row passes only when its evidence
does not contradict the stored agency; every non-GAO row (111 `contract_pattern`)
passes untouched and is not gated by this quarantine.

**Exact-DDL validated** against the real database inside a transaction, then
rolled back: the view returns **344** rows (211 + 111 + 22) against a base table
of **556**, i.e. **212 quarantined = 148 + 64**. Exactly the predicted split.

The base table keeps all 445 GAO rows. `includeUnsupportedAttribution: true` is a
deliberate, explicit escape hatch for a non-agency-specific caller.

## Why `no_title_evidence` is kept

211 rows (47%) carry no agency-shaped title prefix, so the title cannot
adjudicate their attribution **either way**. Excluding them would assert they are
wrong; promoting them would assert they are right. Both are guesses. They remain
visible and are labelled
`[agency attribution UNRESOLVED — not corroborated by the report title]`.

## A3 — caches: nothing to repair

**No cached surface carries a quarantined row.** Measured, not assumed:

- `opp-intel.ts` consumes only `painPoints` / `priorities` / `citations`; it never
  reads `gaoReports`, so GAO rows cannot enter `sam_opportunities.intel_agency`.
- Checked 60 quarantined titles against `sam_opportunities.intel_agency` and
  `agency_target_data_cache.agencies` → **0 hits in each**.
- `LEGACY_GOVINFO` appears in **0** opportunity blobs, TMR caches, briefing
  templates, market reports and proposal jobs.

The 101 opportunities matching `%GAO Report%` are **static-corpus pain points
whose prose mentions GAO** ("…as noted in GAO reports on IT acquisition
management"), not `agency_intelligence` rows.

**Therefore this PR requires no post-merge data repair.** The quarantine is
read-path only — unlike the batch-1 P0, where a cached blob kept serving the
defect after the source was fixed.

## What did NOT change

- `agency_intelligence` — untouched, all 556 rows intact.
- `agency_intelligence_attribution` (#1586) — unchanged.
- No agency is re-attributed or guessed.
- Admin, data-health and monitoring surfaces still see the full corpus.

## Post-merge

1. `npm run migrate` (dry-run) → `npm run migrate -- --go`
2. `npm run db:check -- agency_intelligence_agency_safe attribution_evidence`
3. `select coalesce(attribution_evidence,'(non-gao)'), count(*) from agency_intelligence_agency_safe group by 1;`
   → `no_title_evidence` 211 · `(non-gao)` 111 · `corroborated_by_title` 22
4. `select count(*) from agency_intelligence;` → still **556**

**Rollback:** `DROP VIEW agency_intelligence_agency_safe;` and revert the code.
No data written.

## Known limitations

- The 212 quarantined rows are still **mis-attributed in the record**; they are
  merely unreachable from an agency lookup. Correcting them remains a separate,
  destructive decision.
- `no_title_evidence` carries a text label rather than a structured field on the
  consuming surfaces; a typed provenance channel for `gaoReports` would be better.
