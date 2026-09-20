# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

Verification has **three** layers. Do not collapse them.

| Layer | Meaning |
|---|---|
| **Developer-verified** | Closed by our live tool runs / fixtures on a named serving commit (includes the honesty PRs #1565 / #1571 / #1572 / #1575). |
| **Independently verified** | Confirmed by the external retest PDFs (Round 1 / 2 / 3) with the identical inputs from the 18 Sep issue log. |
| **Agent recheck** | Fresh tool runs in this follow-up (UTC timestamps below) against production aliases and/or the local worktree. Not a Round PDF. |
| **Documented limitation** | Expected honest miss or upstream gap — not an open product bug. |

**Round 3 is not independent verification of all 14 issues.** Round 3 closed the last two *retestable* open items (#4, #14). Eight items were never re-run in Rounds 1–3. Those eight were **developer-verified only** until the agent recheck below.

## Production serving (measured)

| When (UTC) | Alias evidence | Deploy | Git |
|---|---|---|---|
| 2026-09-20T18:54Z (agent recheck) | `maps-account-build:5cc700d79517687a934867c7244ec8d4bd8f994e` on `https://getmindy.ai/` | `dpl_DE5v71VKaWFaq6J9UXL8omhYEWFm` (Ready; aliases include `getmindy.ai` / `mcp.getmindy.ai`) | **`5cc700d7`** (#1576) — **newer than** previously reported `6b14507f` |

Do not assume `6b14507f` remains production. Re-measure.

## Independent retest record (external PDFs)

| Round | Actual test date | Serving commit on prod aliases | Independently confirmed closed | Still open after round | Not retested this round |
|---|---|---|---|---|---|
| Round 1 | **2026-09-20** (PDF file `0920 Mindy_MCP_Retest_Results.pdf`; PDF body still cites the 18 Sep issue log) | post-#1571 Navy/identity fixes (see Round 2) | #1 | #2, #4, #5, #7, #14 | #3, #6, #8, #9, #10, #11, #12, #13 |
| Round 2 | **2026-09-20** (PDF dated “18 September 2026” in the header — **incorrect**; file mtime 2026-09-20) | `73b607cb` (#1571) and follow-ons | #1, #2, #5, #7 | #4, #14 | #3, #6, #8, #9, #10, #11, #12, #13 |
| Round 3 | **2026-09-20** (PDF dated “18 September 2026” in the header — **incorrect**; file mtime 2026-09-20 12:43) | **`6b14507f`** (#1575 SCIF + Monarch reconcile) | #4, #14 (newly); scorecard “6 of 6 retestable” = #1+#2+#4+#5+#7+#14 across rounds — **not** 14/14 | none of the 6 retestable | #3, #6, #8, #9, #10, #11, #12, #13 |

Prior developer honesty retest (not independent): serving commit `15c6b861` · deploy `dpl_3qA6JSAwyJwYUPyAHkRPXsiZqQTM` · PR #1572 · prior merge `73b607cb` (#1571).

## Agent recheck (2026-09-20T18:54:52Z → 18:56:12Z UTC)

**Method:** OAuth MCP session against `https://mcp.getmindy.ai/mcp` (aliases of getmindy.ai) on serving commit **`5cc700d7`**, plus a **local worktree** call for #4 dollar-omission (not yet on prod). Artifact: `tasks/issue-log-14-recheck-2026-09-20.json`. Script: `scripts/issue-log-14-recheck.mjs`.

| # | Tool | Exact input | Result |
|---|------|-------------|--------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **PASS** — 52 rows; `recovered: ["scif"]`; `present_in_source`: loa_range, flight_deck, scif, berthing, magazine; `missing_from_matrix: []`. All five present ≠ full-document completeness (`extraction_completeness: source_text`). |
| 2 | `search_federal_contacts` | `agency: "United States Coast Guard"`, `search: "small business"` | **PASS** — USCG small-business mailbox; not State. Local confirm: `uscg-smallbusiness@uscg.mil`. |
| 3+9 | `build_pursuit_dossier` | `solicitation_number: "N00024-26-R-2200"` | **PASS** — `incumbent: null`, `grounded_incumbent: false`; Mazak only in `prior_awards`; dossier ~19,183 bytes; `_meta.omitted` competition 185/200 + 1,249 doc chars. |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **PASS (prod identity/spend)** — exact match; `command_spending: NOT_ESTABLISHED`; `spending.scope: PARENT_SERVICE` (Navy `$176,557,193,879.18`); `totalObligations: null`. **Prod still emits unsourced priority `$` figures** (expected until this PR deploys). **Local worktree:** priorities have **no `$`**; qualitative Columbia / Virginia / SIOP text retained; LEGACY_MANUAL provenance preserved. |
| 6 | `lookup_federal_osbp` | `"United States Coast Guard"` | **PASS** — Maria L. Kersey-Robinson / `uscg-smallbusiness@uscg.mil` / DHS parent (not State). |
| 8 | `search_past_contracts` | `naics: "336612"` | **PASS** — `queried.naics=336612`; source `naicsCode` / `pscCode` / `awardingOffice` / `recipientState` empty (honest); `popState: LA` ≠ recipient HQ; `_meta.field_status` present. |
| 10 | `get_solicitation_incumbent` | `solicitation_number: "N00024-26-R-2200"` | **PASS** — Lot 1 `2026-08-13`, Lot 2 `2026-08-31`; `deadline_conflict: true`; `grounded_incumbent: false`; `incumbent: null`. |
| 11 | `extract_statement_of_work` | `notice_id: "N00024-26-R-2200"` | **PASS (disclosure)** — `piee: true`, unread PIEE link disclosed, `retrieval_limitation` set; auto-extraction unsupported. |
| 12 | `get_solicitation_documents` | `N00024-26-R-4160` **and** `85a62e9a3f4f4f54b0ade7aa855fcc89` | **PASS (identity)** — both → notice `85a62e9a…`. **Body limitation:** DB `description` currently empty; live SAM noticedesc returned **429** on local probe; `doc_count: 0` (no resourceLinks) remains honest. Prior 8,649-char body is **not currently available** — this is **not** a sol↔UUID divergence. |
| 13 | `referee_proposal_compliance` | 17 requirements, ~15k draft | **SKIPPED** — original payload not in repo/attachments. Never invent a missing original payload. |
| 14 | `lookup_sam_entity` | `name: "Monarch Yachts"` | **PASS** — `not_found`; reconciliation: sam_live_legal 0 / sam_live_dba 0 / local_registry 0; prior DBA claim unsupported. |
| — | `assess_market_depth` | `naics: "336612"` | **PASS** — grounded. |

## Status by issue

| # | Tool | Exact input | Fix status | Verification | Evidence |
|---|------|-------------|------------|--------------|----------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **fixed** | **independently verified** (R1–R3) + **agent recheck** 2026-09-20T18:54Z on `5cc700d7` | SCIF recovery + five named specs present in source/matrix. Completeness ≠ full document. |
| 2 | `search_federal_contacts` | USCG + small business | **fixed** | **independently verified** (R2–R3) + **agent recheck** | Kersey-Robinson / uscg-smallbusiness@uscg.mil. |
| 3 | `build_pursuit_dossier` | `N00024-26-R-2200` | **fixed** | **developer-verified** + **agent recheck** (not Round PDF) | Incumbent null; Mazak prior_awards only. |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **fixed** (+ dollar-omission follow-up) | **independently verified** (R3 identity/spend) + **agent recheck**; dollar omission **local-only until deploy** | Navy parent-service $ ≠ NAVSEA command $. Unsourced LEGACY_MANUAL priority `$` omitted from default text (qualitative programs kept). |
| 5 | `get_agency_spending_detail` | Navy FY2025 | **fixed** | **independently verified** (R2–R3) | Navy ≠ DoD. |
| 6 | `lookup_federal_osbp` | USCG | **fixed** | **developer-verified** + **agent recheck** (not Round PDF) | Same USCG OSBP mailbox. |
| 7 | `get_keyword_coverage` | `"patrol"` | **fixed** | **independently verified** (R2–R3) | — |
| 8 | `search_past_contracts` | `naics: "336612"` | **fixed** (attribution) | **developer-verified** + **agent recheck** | **Limitation:** empty USASpending source columns. |
| 9 | `build_pursuit_dossier` | `N00024-26-R-2200` | **fixed** | **developer-verified** + **agent recheck** | Compact dossier + `_meta.omitted`. |
| 10 | `get_solicitation_incumbent` | `N00024-26-R-2200` | **fixed** | **developer-verified** + **agent recheck** | Lot deadline conflict. |
| 11 | `extract_statement_of_work` | `N00024-26-R-2200` | **fixed** (disclosure) | **developer-verified** + **agent recheck** | **Limitation:** PIEE auto-extract unsupported. |
| 12 | `get_solicitation_documents` | sol + UUID | **fixed** (identity) | **developer-verified** + **agent recheck** | **Limitation:** body currently empty/429; identity still consistent. |
| 13 | `referee_proposal_compliance` | 17 req / ~15k draft | **fixed** (prior) | **developer-verified only** — **not agent-rechecked** (payload absent) | — |
| 14 | `lookup_sam_entity` | `"Monarch Yachts"` | **reconciled** | **independently verified** (R3) + **agent recheck** | Honest miss + reconciliation block. |

## Scorecard (do not misread)

| Round | Retestable items closed (independent) | Independently still open | Not independently retested |
|---|---|---|---|
| Round 1 | 1 of 6 | 5 | 8 |
| Round 2 | 4 of 6 | 2 | 8 |
| Round 3 | **6 of 6 retestable** | **0 of the 6** | **8 still not Round-PDF retested** |

Agent recheck 2026-09-20T18:54Z closed the outstanding live-input queue **except #13** (payload missing). That is **not** the same claim as “Round-PDF independently verified 14/14.”

## Distinctions (not open bugs)

- **#8:** attribution honesty fixed; missing USASpending source columns remain a data limitation.
- **#11:** PIEE disclosure fixed; automatic PIEE extraction remains unsupported.
- **#12:** sol↔UUID identity consistency fixed; current empty body / SAM noticedesc 429 is a retrieval/freshness limitation, not identity drift.
- **#4 follow-up (Round 3 watch):** NAVSEA priority dollar amounts are LEGACY_MANUAL. Default responses omit those amounts and keep qualitative program/opportunity text with LEGACY_MANUAL provenance until each figure is sourced.
- **#14:** zero hits across legal/DBA/local is unsupported-claim / honest miss — not proof of nonregistration forever.

## Still open

- **#13 independent/agent recheck** — blocked on original referee payload.
- **#4 dollar omission on production aliases** — code in this PR; not live until reviewed merge + deploy.

## Not reopened

Pricing, credits, backfills (`--go` writer, 3,729-family, 44,560 fleet), PAE, #1560, agency-identity architecture beyond NAVSEA grain already shipped.
