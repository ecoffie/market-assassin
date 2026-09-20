# Cyrus original 16 findings — disposition after profile/set-aside follow-up

Source: #1581 packet (2026-09-20). This follow-up does **not** reopen #1580 / Epic #12.

| # | Finding | Prior class (#1581) | Disposition now | Notes |
|---|---------|---------------------|-----------------|-------|
| 1 | No 8(a) graduation signal | Enhancement / blocked inference | **Deepened — fixed honesty** | Warehouse `historical_set_asides` with `last_observed_action_fy` + `award_origin_fy` (null when unestablished). Explicit: neither is certification/graduation. Scope note: not from capped recent sample. |
| 2 | Lifetime $ without recency | Reproduced → fixed | **Holds** | `activity_status` / `last_positive_obligation_fy` unchanged. |
| 3 | Negative FY unlabeled | Reproduced → fixed | **Holds** | Positive/deobligation split unchanged. |
| 4 | “Stale coverage” as ingest lag | Unsupported as ingest lag | **Holds** | Recipient last-action labeling unchanged. |
| 5 | Mods as awards | Reproduced → fixed | **Holds** | `modNumber` / grain unchanged. |
| 6 | 17 vs 51 vs 20 | Reproduced → labeled | **Holds** | `counting_bases` still explains; profile/history counts consistent in after repro (17 / 51 / recent unique). |
| 7 | agencies 6 vs top 5 | Cap disclosed | **Holds** | Cap disclosure unchanged. |
| 8 | `count: 0` fabricated | Reproduced → fixed | **Holds** | `count: null` + unavailable flag. |
| 9 | GSA $0 = unused vehicle | Unsupported | **Still open (enhancement)** | Not in this PR. |
| 10 | Invalid date ranges | Reproduced → fixed | **Holds** | Assessment fields unchanged. |
| 11 | Registered vs awarded NAICS | Unsupported | **Still open (do not encode)** | Not in this PR. |
| 12 | Blank PSC row | Reproduced → fixed | **Holds — keep #1580/#12 separate** | No change here. |
| 13 | Profile `award_limit` | Enhancement | **Still deferred** | Not in this PR. |
| 14 | Dense `totals_note` | Reproduced → fixed | **Holds** | Short note unchanged. |
| 15 | Redundant enrichment | Partial / redesign deferred | **Still partial** | Schema redesign deferred. |
| 16 | Match vocab | Light fix | **Holds** | `match_status: unique` kept. |

## New defects found post-#1581 (this PR)

| ID | Defect | Disposition |
|----|--------|-------------|
| N1 | Profile `recent_awards:[]` + `enrichment_status:complete` while history had rows (Pass-2 all-or-nothing gate) | **Fixed** — per-surface cold fill; `bqUnavailable` → `budget_limited` |
| N2 | `last_fy` / sample-derived set-asides conflated action FY with award origin; profile claimed partial empty from empty sample | **Fixed** — v2 warehouse aggregation + explicit field names + scope disclosure |

## Remaining open (not this PR)

- Finding 9 (vehicle unused labeling)
- Finding 11 (NAICS divergence inference — must stay unencoded)
- Finding 13 (optional profile `award_limit`)
- Finding 15 (full enrichment schema redesign)
- Attaching live warehouse ingest clock to every payload
- **Prod verification** of N1/N2 until merge/deploy (local after evidence only)
