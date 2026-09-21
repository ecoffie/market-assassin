# Cyrus original 16 findings — disposition after profile/set-aside follow-up

Source: #1581 packet (2026-09-20). This follow-up does **not** reopen #1580 / Epic #12.

| # | Finding | Prior class (#1581) | Disposition now | Notes |
|---|---------|---------------------|-----------------|-------|
| 1 | No 8(a) graduation signal | Enhancement / blocked inference | **Deepened — fixed honesty** | Warehouse `historical_set_asides` with `last_observed_action_fy` + `first_observed_positive_action_fy` (not award origin). Explicit: neither is certification/graduation. Scope: profile UEI set / rollup children. |
| 2 | Lifetime $ without recency | Reproduced → fixed | **Holds** | Unchanged. |
| 3 | Negative FY unlabeled | Reproduced → fixed | **Holds** | Unchanged. |
| 4 | “Stale coverage” as ingest lag | Unsupported as ingest lag | **Holds** | Unchanged. |
| 5 | Mods as awards | Reproduced → fixed | **Holds** | Unchanged. |
| 6 | 17 vs 51 vs 20 | Reproduced → labeled | **Holds** | Unchanged. |
| 7 | agencies 6 vs top 5 | Cap disclosed | **Holds** | Unchanged. |
| 8 | `count: 0` fabricated | Reproduced → fixed | **Holds** | Unchanged. |
| 9 | GSA $0 = unused vehicle | Unsupported | **Still open (enhancement)** | Not in this PR. |
| 10 | Invalid date ranges | Reproduced → fixed | **Holds** | Unchanged. |
| 11 | Registered vs awarded NAICS | Unsupported | **Still open (do not encode)** | Not in this PR. |
| 12 | Blank PSC row | Reproduced → fixed | **Holds — keep #1580/#12 separate** | No change here. |
| 13 | Profile `award_limit` | Enhancement | **Still deferred** | Not in this PR. |
| 14 | Dense `totals_note` | Reproduced → fixed | **Holds** | Unchanged. |
| 15 | Redundant enrichment | Partial / redesign deferred | **Still partial** | Deferred. |
| 16 | Match vocab | Light fix | **Holds** | Unchanged. |

## New defects found post-#1581 (this PR)

| ID | Defect | Disposition |
|----|--------|-------------|
| N1 | Profile `recent_awards:[]` + `enrichment_status:complete` while history had rows (Pass-2 all-or-nothing gate) | **Fixed** — per-surface cold fill via `bqUnavailable` |
| N2 | Action FY conflated with award origin; sample-derived set-asides | **Fixed** — `first_observed_positive_action_fy`; award origin unknown without origin evidence |
| N3 (review) | `award_origin_fy` label on `MIN(positive)` | **Corrected** — renamed; origin not claimed |
| N4 (review) | Warm-empty `length===0` consumed cold budget / became `budget_limited` | **Corrected** — gate on unavailable/failed only |
| N5 (review) | Scope note “for this UEI” on rollup `childUeis` | **Corrected** — “UEI set” |

## Remaining open (not this PR)

- Finding 9, 11, 13, 15 as above
- **Prod verification** until merge/deploy (local after evidence only)
