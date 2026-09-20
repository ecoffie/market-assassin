# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

Verification has two layers. Do not collapse them.

| Layer | Meaning |
|---|---|
| **Developer-verified** | Closed by our live tool runs / fixtures on a named serving commit. |
| **Independently verified** | Confirmed by the external retest PDFs (Round 1 / 2 / 3) with the identical inputs from the 18 Sep issue log. |

**Round 3 is not independent verification of all 14 issues.** Round 3 closed the last two *retestable* open items (#4, #14). Eight items were never re-run in Rounds 1–3 (they need a live solicitation or a specific payload). Those eight remain **developer-verified only**.

## Independent retest record

| Round | Actual test date | Serving commit on prod aliases | Independently confirmed closed | Still open after round | Not retested this round |
|---|---|---|---|---|---|
| Round 1 | **2026-09-20** (PDF file `0920 Mindy_MCP_Retest_Results.pdf`; PDF body still cites the 18 Sep issue log) | post-#1571 Navy/identity fixes (see Round 2) | #1 | #2, #4, #5, #7, #14 | #3, #6, #8, #9, #10, #11, #12, #13 |
| Round 2 | **2026-09-20** (PDF dated “18 September 2026” in the header — **incorrect**; file mtime 2026-09-20) | `73b607cb` (#1571) and follow-ons | #1, #2, #5, #7 | #4, #14 | #3, #6, #8, #9, #10, #11, #12, #13 |
| Round 3 | **2026-09-20** (PDF dated “18 September 2026” in the header — **incorrect**; file mtime 2026-09-20 12:43) | **`6b14507f`** (#1575 SCIF + Monarch reconcile; aliases `getmindy.ai` / `mcp.getmindy.ai`) | #4, #14 (newly); scorecard “6 of 6 retestable” = #1+#2+#4+#5+#7+#14 across rounds — **not** 14/14 | none of the 6 retestable | #3, #6, #8, #9, #10, #11, #12, #13 |

Prior developer honesty retest (not independent): serving commit `15c6b861` · deploy `dpl_3qA6JSAwyJwYUPyAHkRPXsiZqQTM` · PR #1572 · prior merge `73b607cb` (#1571).

## Status by issue

| # | Tool | Exact input | Fix status | Verification | Evidence |
|---|------|-------------|------------|--------------|----------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **fixed** | **independently verified** (R1–R3) | Source has "Notional 750 sq ft SCIF". Deterministic `recoverMissingSourceSpecs`. Live: `FULL_HAS_SCIF true`, 51 rows. |
| 2 | `search_federal_contacts` | `agency: "United States Coast Guard"`, `search: "small business"` | **fixed** | **independently verified** (R2–R3) | Kersey-Robinson / uscg-smallbusiness@uscg.mil. `73b607cb`. |
| 3 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed** | **developer-verified only** | `15c6b861`: `incumbent: null`, `grounded_incumbent: false`; Mazak only `prior_awards[0]`. Not retested in R1–R3. |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **fixed** | **independently verified** (R3) | NAVSEA resolves; `command_spending` NOT_ESTABLISHED; spending scope PARENT_SERVICE (Navy $176.6B is parent-service, not NAVSEA). Round 3 watch: unsourced priority **dollar** figures — omitted from default responses until sourced (qualitative programs kept, LEGACY_MANUAL provenance preserved). |
| 5 | `get_agency_spending_detail` | `"Department of the Navy"`, FY2025 | **fixed** | **independently verified** (R2–R3) | Navy $176.56B ≠ DoD $491.77B. `73b607cb`. |
| 6 | `lookup_federal_osbp` | `"United States Coast Guard"` | **fixed** | **developer-verified only** | Same Kersey-Robinson payload. `73b607cb`. Not retested in R1–R3. |
| 7 | `get_keyword_coverage` | `"patrol"` | **fixed** | **independently verified** (R2–R3) | $6.67B, 106 NAICS. `73b607cb`. |
| 8 | `search_past_contracts` | `naics: "336612"` | **fixed** (attribution) | **developer-verified only** | Filter-stamped NAICS honesty fixed. Empty USASpending source columns remain a data limitation. Not retested in R1–R3. |
| 9 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed** | **developer-verified only** | `15c6b861`: dossier sized with `_meta.omitted`. Not retested in R1–R3. |
| 10 | `lookup_solicitation` / incumbent | `solicitation_number: "N00024-26-R-2200"` | **fixed** | **developer-verified only** | Lot deadline conflict. `73b607cb`. Not retested in R1–R3. |
| 11 | `extract_statement_of_work` | `notice_id: "N00024-26-R-2200"` | **fixed** (disclosure) | **developer-verified only** | PIEE unread attachment disclosed; auto-extraction unsupported. Not retested in R1–R3. |
| 12 | `get_solicitation_documents` | `notice_id: "N00024-26-R-4160"` **and** UUID `85a62e9a…` | **fixed** | **developer-verified only** | Both resolve to same notice body. `15c6b861`. Not retested in R1–R3. |
| 13 | `referee_proposal_compliance` | 17 requirements, ~15k draft | **fixed** | **developer-verified only** | 7.8s, `timed_out: false`. Not retested in R1–R3. |
| 14 | `lookup_sam_entity` | `name: "Monarch Yachts"` | **reconciled** | **independently verified** (R3) | Live SAM legal + DBA + local `sam_entities` = 0 hits; reconciliation block. Honest miss — prior DBA claim unsupported by current sources. `6b14507f`. |

## Scorecard (do not misread)

| Round | Retestable items closed (independent) | Independently still open | Not independently retested |
|---|---|---|---|
| Round 1 | 1 of 6 | 5 | 8 |
| Round 2 | 4 of 6 | 2 | 8 |
| Round 3 | **6 of 6 retestable** | **0 of the 6** | **8 still not independently retested** |

Developer fix status for the original 14: all closed or reconciled (with documented #8 / #11 limitations). That is **not** the same claim as “independently verified 14/14.”

## Distinctions (not open bugs)

- **#8:** attribution honesty fixed; missing USASpending source columns remain a data limitation.
- **#11:** PIEE disclosure fixed; automatic PIEE extraction remains unsupported.
- **#4 follow-up (Round 3 watch):** NAVSEA priority dollar amounts are LEGACY_MANUAL. Default responses omit those amounts and keep qualitative program/opportunity text with LEGACY_MANUAL provenance until each figure is sourced.

## Still open (independent verification queue)

Items **3, 6, 8, 9, 10, 11, 12, 13** — developer-verified; awaiting an independent retest with a live solicitation or specific payload.

## Not reopened

Pricing, backfills, agency-identity architecture, and documented #8/#11 limitations.
