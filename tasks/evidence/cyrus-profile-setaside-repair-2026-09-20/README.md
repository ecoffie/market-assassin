# Cyrus profile / set-aside follow-up — evidence (2026-09-20)

Follow-up to #1581. Two targeted repairs + one correction batch. **Not merged/deployed.**

## Root causes (traced, not assumed)

1. **Empty `recent_awards` on profile** while history had rows  
   - Profile keys: `rollup:{uei}:recent-awards:5:v4-m`  
   - History keys: `rollup:single:{uei}:recent-awards:25:v4-m` (different namespace + limit)  
   - Pass-2 gate required `awards.length===0 && agencies.length===0`. Cyrus had warm agencies + cold awards → Pass-2 skipped → `recent_awards:[]` with `enrichment_status:"complete"`.

2. **Action FY conflated with award origin**  
   - Warehouse `MAX(fiscal_year)` is last *action* FY.  
   - `MIN(positive obligation FY)` is first observed *positive action* FY — a later positive modification is not award origin.

## Correction batch (post-review on `78f1ee6d`)

1. Renamed `award_origin_fy` → `first_observed_positive_action_fy` (cache key v3). Award origin remains unknown unless a dedicated origin signal exists.
2. Pass-2 cold-fill gated on `bqUnavailable` (miss/failed), not `length === 0`. Warm-empty + denied cold budget stays `complete`.
3. Profile scope note says "UEI set" (rollup children), not "this UEI".

## Before (prod acceptance, post-#1581)

| Surface | Evidence | Result |
|---------|----------|--------|
| Profile | `before-profile-prod.json` | `recent_awards: []`, `enrichment_status: complete`, award_count 17, set-asides partial/empty |
| History | `before-history-prod.json` | recent awards present |

## After (local)

| Surface | Evidence | Result |
|---------|----------|--------|
| Profile (initial fix) | `after-local-repro.json` | `recent_len: 5` |
| Profile (correction) | `after-correction-local.json` | no `award_origin_fy_*`; `first_observed_positive_action_fy_*`; scope "UEI set"; origin denied in note |

See `summary.json` for the delta.

## Regressions

- `tier2-tools.unit.test.ts` — warm path; Cyrus Pass-2; failed→`budget_limited`; **warm-empty set-aside + cold budget denied stays complete**
- `award-history-shape.unit.test.ts` — deobligation ≠ origin; **older award + later positive mod ≠ award origin**
- `bq-history-completeness.unit.test.ts` — v3 set-aside fields + unavailable coverage
