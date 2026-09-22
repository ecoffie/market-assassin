# Cyrus freshness / provenance follow-up — PR packet

**Branch:** `fix/cyrus-freshness-provenance`  
**Base:** `origin/main`  
**Date:** 2026-09-20  
**Stop:** before merge / deploy. No production writes. `#1580` / original audit `#12` untouched.

## Reproduced findings (before)

See `before-repro.json`. Summary:

| ID | Finding | Before |
|----|---------|--------|
| F1 | Freshness clocks unwired | Profile/history attached recipient last action only; `data_sources.bq_awards` already had warehouse max `2026-09-18` + healthy ingest clocks |
| F2 | Set-aside provenance missing | No contributing UEIs / supporting actions; null first-positive easily misread as “all deobligations”; rollup vs single-UEI only in prose |
| F3 | `last_fy_by_label` unmarked | Still emitted; consumers = API payload + unit tests only (no UI reader) |
| F4 | Zero-$ agency-years | 19 zero `amount`/`count>0` cells; no unused label today — guard against inventing one |

## Repairs (after)

See `after-repro.json` (live BQ canary UEI `FCJCDUZV7RM3`).

| ID | After evidence |
|----|----------------|
| F1 | History + profile: `warehouse_max_action_date=2026-09-18`, ingest `healthy`, `coverage_complete_established=true`. Missing clocks → unknown (not inferred from recipient last action). |
| F2 | `scope.kind` = `history_single_uei` vs `profile_rollup`; contributing UEIs + supporting actions per label; `null_first_positive_note` present. |
| F3 | `last_fy_by_label` still present (compat); `deprecated.last_fy_by_label` marker; aliases match `last_observed_action_fy_by_label`. |
| F4 | Zero cells classify as `zero_net_obligations`, `unused_vehicle: false`; note forbids unused-vehicle from $0 alone. |

## Compatibility risks

- **Additive payload fields** on `coverage_timestamp`, `coverage` (profile), `historical_set_asides`, and `agencyBreakdown` cells. Existing keys preserved.
- **Cache key bump** `set-aside-history:v3-m` → `v4-m` (cold refill on next access; no schema migration).
- **`last_fy_by_label` retained** as deprecated alias — removing it would break any external consumer that only reads that key.
- Soft-read of `data_sources` via service role; failure → clocks unknown (fail-open for the tool, not fabricated healthy).

## Preserved (#1589)

Counting bases, activity/uncertainty handling, action-date / first-positive ≠ award-origin semantics, Pass-2 / `bqUnavailable` set-aside incompleteness — covered by existing + new unit tests (55 passing in the three targeted files).

## Blocked / deferred (not release blockers)

- Configurable `award_limit`
- Duplicate metadata cleanup
- Casing consistency on set-aside labels
- NAICS comparison changes
- Authoritative award-type / IDV column on warehouse awards (needed before any future “unused vehicle” claim)
- `#1580` / original audit `#12`

## Tests

```bash
npx vitest run \
  src/lib/contractor/award-history-shape.unit.test.ts \
  src/lib/bigquery/bq-history-completeness.unit.test.ts \
  src/lib/chat/tier2-tools.unit.test.ts
# 55 passed
```

## Explicit non-goals this PR

- Merge to `main`
- `vercel --prod`
- Production DB writes / backfills
- Reopening Potato / CAI / Family backfill tracks
