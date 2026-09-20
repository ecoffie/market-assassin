# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

**Serving commit (targeted honesty retest):** `15c6b861` · deploy `dpl_3qA6JSAwyJwYUPyAHkRPXsiZqQTM` · aliases `getmindy.ai` / `mcp.getmindy.ai`  
**PR:** https://github.com/ecoffie/market-assassin/pull/1572  
**Prior merge:** `73b607cb` (#1571)  
**SCIF + Monarch reconcile:** branch `fix/scif-monarch-reconcile` (this file updated with that work)

| # | Tool | Exact input | Status | Evidence |
|---|------|-------------|--------|----------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **fixed** | Source has "Notional 750 sq ft SCIF". Deterministic `recoverMissingSourceSpecs` injects SCIF (and other named Section 3.0 anchors) when the LLM skips notional capability lines. Live retest: `FULL_HAS_SCIF true`, `missing_from_matrix: []`, 51 rows; recovery path alone recovers `scif` from the notional sentence. |
| 2 | `search_federal_contacts` | `agency: "United States Coast Guard"`, `search: "small business"` | **fixed** | Kersey-Robinson / uscg-smallbusiness@uscg.mil. `73b607cb`. |
| 3 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed** | `15c6b861`: `incumbent: null`, `incumbent_name: null`, `grounded_incumbent: false`; Mazak only `prior_awards[0]`. |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **fixed** | NAVSEA `PARENT_SERVICE`; parent_service_total $176,557,193,879.18. `73b607cb`. |
| 5 | `get_agency_spending_detail` | `"Department of the Navy"`, FY2025 | **fixed** | Navy $176.56B ≠ DoD $491.77B. `73b607cb`. |
| 6 | `lookup_federal_osbp` | `"United States Coast Guard"` | **fixed** | Same Kersey-Robinson payload. `73b607cb`. |
| 7 | `get_keyword_coverage` | `"patrol"` | **fixed** | $6.67B, 106 NAICS. `73b607cb`. |
| 8 | `search_past_contracts` | `naics: "336612"` | **fixed** (attribution) | Misleading filter-stamped NAICS fixed (`naicsCode: ""`, `queriedNaics: "336612"`). Empty source fields (`pscCode`, `awardingOffice`, `recipientState`) remain a USASpending data limitation — not invented. `popState: LA` ≠ recipient HQ. |
| 9 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **fixed** | `15c6b861`: dossier **19,201 bytes**; `_meta.omitted` = 185/200 competition firms omitted + 1,249 doc chars truncated. |
| 10 | `lookup_solicitation` / incumbent | `solicitation_number: "N00024-26-R-2200"` | **fixed** | Lot 1 2026-08-13 vs Lot 2/SAM 2026-08-31. `73b607cb`. |
| 11 | `extract_statement_of_work` | `notice_id: "N00024-26-R-2200"` | **fixed** (disclosure) | Unread PIEE attachment disclosed (`piee_links`, `retrieval_limitation`, `unread_attachments: 1`). Automatic extraction from PIEE remains unsupported. |
| 12 | `get_solicitation_documents` | `notice_id: "N00024-26-R-4160"` **and** UUID `85a62e9a3f4f4f54b0ade7aa855fcc89` | **fixed** | `15c6b861`: both → notice `85a62e9a…`, **8,649** description chars, `grounded: true`, identical body. `doc_count: 0` (no SAM resourceLinks on this RFI — honest). |
| 13 | `referee_proposal_compliance` | 17 requirements, ~15k draft | **fixed** | 7.8s, `timed_out: false`. |
| 14 | `lookup_sam_entity` | `name: "Monarch Yachts"` | **reconciled** | Live SAM legal + DBA + local `sam_entities` all return **0** hits. `lookup_status: not_found`, `grounded: false`, `degraded: false`, with `_meta.reconciliation` documenting the three sources. DBA unique-pick still works when a DBA row exists (unit fixtures). Original "Monarch Marine Works DBA Monarch Yachts" claim is **not supported by current sources** — honest miss, not a missed classifier. |

## Distinctions (not open bugs)

- **#8:** attribution honesty fixed; missing USASpending source columns remain a data limitation.
- **#11:** PIEE disclosure fixed; automatic PIEE extraction remains unsupported.

## Still open

None from the original 14.

## Not reopened

Pricing, backfills, agency-identity architecture, already-closed #2/#4–#7/#10/#13, and documented #8/#11 limitations.
