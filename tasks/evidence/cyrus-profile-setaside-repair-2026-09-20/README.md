# Cyrus profile / set-aside follow-up — evidence (2026-09-20)

Follow-up to #1581. Two targeted repairs only. **Not merged/deployed.**

## Root causes (traced, not assumed)

1. **Empty `recent_awards` on profile** while history had rows  
   - Profile keys: `rollup:{uei}:recent-awards:5:v4-m`  
   - History keys: `rollup:single:{uei}:recent-awards:25:v4-m` (different namespace + limit)  
   - Pass-2 gate required `awards.length===0 && agencies.length===0`. Cyrus had warm agencies + cold awards → Pass-2 skipped → `recent_awards:[]` with `enrichment_status:"complete"`.

2. **`last_fy` mixed deobligations into “award year”**  
   - Warehouse `MAX(fiscal_year)` is last *action* FY.  
   - Profile previously sampled capped `recent_awards` with `coverage:"partial"` and empty labels when that sample was empty.

## Before (prod acceptance, post-#1581)

| Surface | Evidence | Result |
|---------|----------|--------|
| Profile | `before-profile-prod.json` | `recent_awards: []`, `enrichment_status: complete`, award_count 17, set-asides partial/empty |
| History | `before-history-prod.json` | recent awards present (25 rows in fixture) |

## After (local worktree, this branch)

| Surface | Evidence | Result |
|---------|----------|--------|
| Profile | `after-local-repro.json` | `recent_len: 5`, enrichment complete, warehouse set-aside aggregation |
| History | same | set-asides match profile labels/FYs; `8A COMPETED` origin `null`, last action FY 2023 |

See `summary.json` for the delta.

## Regressions

- `tier2-tools.unit.test.ts` — warm path; Cyrus warm-agencies/cold-awards Pass-2; failed retrieval → `budget_limited`
- `award-history-shape.unit.test.ts` — deobligation FY ≠ origin; unknown origin stays null
- `bq-history-completeness.unit.test.ts` — v2 set-aside fields + unavailable coverage
