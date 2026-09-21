# Cyrus contractor-lookup — acceptance scope freeze

**Batch:** audit closure (original 16 + correction rounds + Round-3 follow-up F1–F4)  
**Subject:** Cyrus Management Solutions LLC · UEI `N1N9JPDYHVC7`  
**Tools:** `get_contractor_profile` · `lookup_sam_entity` · `get_contractor_award_history`  
**Out of scope:** PR #1580 / original audit #12 · Potato / CAI / Family backfills · production writes  
**Status vocabulary:** `PR ready for review` ≠ `fixed in production`

Sources: original audit MD (2026-09-19), #1581 packet, #1589 disposition, post-#1589 Round-3 follow-up (freshness/provenance).  
Note: `Mindy_MCP_Retest_Round3.pdf` is the **agency-intel / Monarch** scorecard — not this contractor track.

---

## Disposition table

| ID | Finding | Class | Expected customer-visible behavior | Acceptance check (before coding) |
|----|---------|-------|--------------------------------------|----------------------------------|
| O1 | No 8(a) graduation signal | Already fixed (honesty) + regression | Historical set-asides shown with action/positive FYs; **no** certification/graduation claim; SAM `has8a` stays current-only | Profile+history: `historical_set_asides` present; note denies graduation/cert; **no** `award_origin_fy_*`; SAM does not invent formerCertifications |
| O2 | Lifetime $ without recency | Already fixed + regression | Profile exposes `last_positive_obligation_fy` + `activity_status` (+ observation period) | Profile: both fields present; dormant/zero years do not read as “active $15M contractor” without activity fields |
| O3 | Negative FY unlabeled | Already fixed + regression | Series carries positive/deobligation components when available; never invent from net | History series rows with known components keep both fields; net-only rows leave components undefined |
| O4 | Stale coverage as ingest lag | **Confirmed defect → repaired (F1)** | Three clocks: recipient last action ≠ warehouse max ≠ ingest freshness; missing → unknown; recent action alone ≠ complete coverage | `coverage_timestamp` / profile `coverage`: warehouse max + ingest status; `coverage_complete_established` false when clocks missing |
| O5 | Mods as awards | Already fixed + regression | Recent rows labeled as obligation actions; mod classification; counting bases separate | `grain=obligation_action`; `modClassification` / `isModification` present; counting bases note mods |
| O6 | 17 vs 51 vs 20 unlabeled | Already fixed + regression | Explicit grains: unique awards, FY-sum, actions, sample unique | `counting_bases` has unique_awards, fiscal_year_award_count_sum, recent_* |
| O7 | agencies 6 vs top 5 | Already fixed | Cap disclosed; negative nets included | `top_agencies_capped` / note when served > returned |
| O8 | `count: 0` fabricated | Already fixed + regression | Agency count null + unavailable when not queried | `count: null`, `count_unavailable: true` |
| O9 | GSA $0 = unused vehicle | **Confirmed defect → repaired (F4 honesty)** | Zero net + actions → `zero_net_obligations`; **never** `unused_vehicle: true` without award-type evidence | Agency-year cells: `unused_vehicle===false`; note forbids unused-vehicle from $0 alone |
| O10 | Impossible date ranges | Already fixed + regression | Invalid ranges flagged | Canary PIID `693JK418P500008`: assessment `invalid`, issue `end_before_start` |
| O11 | Registered vs awarded NAICS | Evidence unavailable / do not encode | No fabricated “pivot” claim | Tools do **not** invent NAICS divergence narrative |
| O12 | Blank PSC row | Leave #1580/#12 untouched | (Separate track) | **No change in this PR** |
| O13 | Profile `award_limit` | Optional enhancement | — | Deferred; not a defect |
| O14 | Dense `totals_note` | Already fixed | Short note | `SHORT_TOTALS_NOTE` / short profile note |
| O15 | Redundant enrichment meta | Optional enhancement / partial | — | Deferred |
| O16 | Match vocab | Already fixed (light) | Shared `match_status` where applicable | Profile/history carry shared vocabulary fields |
| N1 | Profile empty awards while history had rows | Already fixed + regression | Warm agencies + cold awards → Pass-2 fills awards | Unit: warm agencies / cold awards → `recent_awards.length>0`, complete |
| N2/N3 | Set-aside from sample / award_origin label | Already fixed + regression | Warehouse set-aside query; positive FY ≠ origin | No `award_origin_fy`; note denies origin; not from capped recent sample |
| N4 | Warm empty → budget_limited | Already fixed + regression | Confirmed empty warm ≠ unavailable | Warm-empty set-aside + denied budget → complete, labels `[]` |
| N5 | Scope “this UEI” on rollup | Already fixed + regression | Machine-readable scope | Profile `scope.kind=profile_rollup`; history `history_single_uei` |
| F1 | Freshness clocks unwired | **Confirmed defect → repaired** | See O4 | See O4 |
| F2 | Set-aside provenance missing | **Confirmed defect → repaired** | Per-label contributing UEIs + supporting actions; rollup vs history scope | `contributing_ueis_by_label` + `supporting_actions_by_label` non-empty when data exists |
| F3 | Null first-positive ⇒ all deobligations | **Confirmed defect → repaired** | Explicit note: null ≠ all deobligations | `null_first_positive_note` present and matches contract |
| F4 | `last_fy_by_label` unmarked | **Confirmed defect → repaired** | Deprecated alias retained + marker | `deprecated.last_fy_by_label.status=deprecated`; values match `last_observed_action_fy_by_label` |

### Enhancements (not defects — not finish-line)

- Configurable profile `award_limit` (O13)
- Duplicate enrichment metadata cleanup (O15)
- Set-aside label casing consistency
- Registered-vs-awarded NAICS comparison UI (O11 encoding)
- Authoritative award-type column for unused-vehicle claims (blocked until warehouse has type evidence)

---

## In-scope finish line for this PR

1. Disposition above frozen.  
2. Local three-tool baseline on `N1N9JPDYHVC7` with SHA + UTC + env recorded.  
3. F1–F4 repaired with before/after evidence.  
4. Regression suite for protected invariants (section 4 of the batch brief).  
5. Separate verifier pass on the diff.  
6. One PR + review packet; **stop before merge/deploy**.

Production closure requires a **separately approved** release, then the **same** saved acceptance suite against authenticated public MCP compared to this local baseline.
