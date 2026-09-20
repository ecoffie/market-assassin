# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

**Serving commit for latest targeted checks:** see row Evidence column (retested after honesty fixes).
**Do not mark fixed without the original tool + exact input.** Unverified ≠ fixed.

| # | Tool | Exact input | Status | Evidence |
|---|------|-------------|--------|----------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **open** (SCIF) | Source has LOA/flight deck/SCIF/berthing/magazine. Matrix still `missing_from_matrix: [scif]`; completeness `unproven`. Keep open. |
| 2 | `search_federal_contacts` | `agency: "United States Coast Guard"`, `search: "small business"` | **fixed** | Maria L. Kersey-Robinson, uscg-smallbusiness@uscg.mil. Commit `73b607cb`. |
| 3 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed** | Prod `73b607cb`: `incumbent: null`, `_meta.incumbent_name: null`; Mazak only in `prior_awards[0]`. (Helper alone was insufficient — dossier is the original tool.) |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **fixed** | NAVSEA `PARENT_SERVICE`; `totalObligations: null`; parent_service_total $176,557,193,879.18. `73b607cb`. |
| 5 | `get_agency_spending_detail` | `"Department of the Navy"`, FY2025 | **fixed** | Navy $176.56B (not DoD $491.77B). `73b607cb`. |
| 6 | `lookup_federal_osbp` | `"United States Coast Guard"` | **fixed** | Same Kersey-Robinson payload. `73b607cb`. |
| 7 | `get_keyword_coverage` | `"patrol"` | **fixed** | $6.67B, 106 NAICS. `73b607cb`. |
| 8 | `search_past_contracts` | `naics: "336612"` | **fixed*** | *Pending post-deploy retest.* Code: `naicsCode` source-only (no filter stamp); `queriedNaics` separate; `_meta.field_status` states `popState` ≠ recipient HQ. Pre-fix prod still stamped `336612`. |
| 9 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed*** | *Pending post-deploy retest.* Pre-fix dossier **19,048 bytes**; competition 15/200 via market-depth meta. Code adds `_meta.omitted` (competition + truncated doc text). Market-depth alone was insufficient. |
| 10 | `lookup_solicitation` / incumbent | `solicitation_number: "N00024-26-R-2200"` | **fixed** | `lot_due_dates`: Lot 1 2026-08-13 vs Lot 2/SAM 2026-08-31. Notice `3a6a586d85964c15aa010ccc7a5914ed`. `73b607cb`. |
| 11 | `extract_statement_of_work` | `notice_id: "N00024-26-R-2200"` | **fixed*** | *Pending post-deploy retest.* Pre-fix: `_meta.piee: true`, `found: false` only. Code adds `piee_links`, `retrieval_limitation`, listed vs unread attachment counts. |
| 12 | `get_solicitation_documents` | `notice_id: "N00024-26-R-4160"` **and** UUID `85a62e9a3f4f4f54b0ade7aa855fcc89` | **fixed*** | *Pending post-deploy retest.* Pre-fix both resolved notice but `doc_count:0`, empty description (`source:none`). Code on-demand resolves noticedesc so sol# and UUID return the same body. |
| 13 | `referee_proposal_compliance` | 17 requirements, ~15k draft | **fixed** | 7.8s, `timed_out: false`. |
| 14 | `lookup_sam_entity` | `name: "Monarch Yachts"` | **open** | `not_found` / `sam_live`. DBA classifier present; entity not in SAM. Keep open. |

\* Rows marked fixed\* are code-complete on this branch; status becomes **fixed** only after prod MCP retest on the serving commit.

## Still open (product)

- **#1 SCIF extraction**
- **#14 Monarch Yachts**

## Not reopened

Pricing, backfills, agency-identity architecture, already-closed #2/#4–#7/#10/#13.
