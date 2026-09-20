# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

Verification has **four** layers. Do not collapse them. **This audit is not fully closed.**

| Layer | Meaning |
|---|---|
| **Developer-verified** | Closed by our live tool runs / fixtures on a named serving commit (includes the honesty PRs #1565 / #1571 / #1572 / #1575). Historical — does not substitute for a fresh recheck. |
| **Independently verified** | Confirmed by an external retest PDF **with a recorded execution time and serving commit**. PDF *upload* / file mtime / cover-date alone do **not** establish either. |
| **Agent rechecked** | Fresh tool runs in this follow-up (UTC timestamps below) against production aliases and/or the local worktree. Not a Round PDF. |
| **Documented limitation** | Expected honest miss or upstream gap — not an open product bug. |

## Production serving (measured)

| When (UTC) | Alias evidence | Deploy | Git |
|---|---|---|---|
| 2026-09-20T18:54Z (agent recheck) | `maps-account-build:5cc700d79517687a934867c7244ec8d4bd8f994e` on `https://getmindy.ai/` | `dpl_DE5v71VKaWFaq6J9UXL8omhYEWFm` (Ready; aliases include `getmindy.ai` / `mcp.getmindy.ai`) | **`5cc700d7`** (#1576) |

Do not assume an older commit remains production. Re-measure.

## Independent retest record (external PDFs)

**Caveat:** Round PDF cover dates and upload/file mtimes are **not** execution timestamps. Unless a PDF records wall-clock UTC and the production serving commit, those fields stay **unknown**.

| Round | PDF artifact | Execution date (UTC) | Serving commit | What the PDF itself claims | Caveats |
|---|---|---|---|---|---|
| Round 1 | `0920 Mindy_MCP_Retest_Results.pdf` (body cites 18 Sep issue log) | **unknown** | **unknown** | Scorecard progress toward retestable items; includes early SCIF discussion | Upload/mtime ≠ execution. Do not treat as proof of a named prod SHA. |
| Round 2 | Round 2 PDF (header “18 September 2026”) | **unknown** | **unknown** (PDF cites post-#1571 / `73b607cb` era work — **not measured here**) | Contacts / Navy spend / keyword / related items among the “retestable” set | **Missed SCIF** — Round 2 did not confirm SCIF recovery. |
| Round 3 | Round 3 PDF (header “18 September 2026”; file mtime ~2026-09-20 12:43 local) | **unknown** | PDF *names* `6b14507f` — **not re-measured in this pass as Round-3 serving proof** | Newly: #4 NAVSEA identity/spend grain; #14 Monarch reconcile. Scorecard “6 of 6 retestable” across rounds | **Did not freshly verify SCIF.** Did not retest #3, #6, #8–#13. |

Prior developer honesty retest (not independent): serving commit `15c6b861` · deploy `dpl_3qA6JSAwyJwYUPyAHkRPXsiZqQTM` · PR #1572 · prior merge `73b607cb` (#1571).

## Agent recheck (2026-09-20T18:54:52Z → 18:56:12Z UTC)

**Method:** OAuth MCP session against `https://mcp.getmindy.ai/mcp` (aliases of getmindy.ai) on serving commit **`5cc700d7`**, plus a **local worktree** call for #4 dollar-omission (not on prod until a separately approved release). Artifact: `tasks/issue-log-14-recheck-2026-09-20.json`. Script: `scripts/issue-log-14-recheck.mjs`.

| # | Tool | Exact input | Result |
|---|------|-------------|--------|
| 1 | `extract_compliance_matrix` | `notice_id: "6552b25bf0e648f39b44228275998eef"` | **Agent-rechecked PASS** — 52 rows; `recovered: ["scif"]`; `present_in_source`: loa_range, flight_deck, scif, berthing, magazine; `missing_from_matrix: []`. All five present ≠ full-document completeness. **Not Round-PDF independent SCIF proof** (R2 missed SCIF; R3 did not freshly verify). |
| 2 | `search_federal_contacts` | USCG + `small business` | **PASS** — `uscg-smallbusiness@uscg.mil`; not State. |
| 3+9 | `build_pursuit_dossier` | `N00024-26-R-2200` | **PASS** — `incumbent: null`; Mazak only in `prior_awards`; compact dossier + `_meta.omitted`. |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | **PASS (prod identity/spend)** — `NOT_ESTABLISHED` command spend; `PARENT_SERVICE` Navy total. **Prod still emits unsourced priority `$` until separately approved release of this PR.** Local: priorities have no `$` after omit-empty fix. |
| 6 | `lookup_federal_osbp` | USCG | **PASS** — Kersey-Robinson / `uscg-smallbusiness@uscg.mil`. |
| 8 | `search_past_contracts` | `naics: "336612"` | **PASS** — attribution honesty; empty source fields; `popState` ≠ recipient HQ. |
| 10 | `get_solicitation_incumbent` | `N00024-26-R-2200` | **PASS** — Lot 1 `2026-08-13` / Lot 2 `2026-08-31`; `deadline_conflict: true`; no grounded incumbent. |
| 11 | `extract_statement_of_work` | `N00024-26-R-2200` | **PASS (disclosure)** — PIEE unread disclosed; auto-extract unsupported. |
| 12 | `get_solicitation_documents` | `N00024-26-R-4160` **and** UUID `85a62e9a…` | **Split verdict:** **identity PASSED** (both → `85a62e9a…`). **Retrieval INCOMPLETE** — DB description empty; live SAM noticedesc **429**; `doc_count: 0`. Do not collapse into a single overall pass. |
| 13 | `referee_proposal_compliance` | 17 requirements, ~15k draft | **UNVERIFIED in this pass** — original payload absent. Prior developer result is historical only; not an exact rerun. |
| 14 | `lookup_sam_entity` | `"Monarch Yachts"` | **PASS** — reconciled `not_found` across legal/DBA/local. |
| — | `assess_market_depth` | `naics: "336612"` | **PASS** — grounded. |

## Status by issue

| # | Tool | Exact input | Fix status | Verification | Evidence |
|---|------|-------------|------------|--------------|----------|
| 1 | `extract_compliance_matrix` | matrix notice | **fixed** | **agent-rechecked** 2026-09-20T18:54Z on `5cc700d7`. Round-PDF SCIF independence **not established** (R2 missed; R3 no fresh SCIF). | SCIF recovered; five named specs present. Completeness ≠ full document. |
| 2 | `search_federal_contacts` | USCG + small business | **fixed** | Round PDF claims exist; **execution date/commit unknown**. **Agent-rechecked.** | USCG mailbox, not State. |
| 3 | `build_pursuit_dossier` | `N00024-26-R-2200` | **fixed** | **developer-verified** (historical) + **agent-rechecked** | Incumbent null; Mazak prior_awards only. |
| 4 | `get_agency_intel` | NAVSEA | **fixed** (+ dollar-omission) | Round 3 PDF claims identity/spend; **execution date unknown**. **Agent-rechecked** identity/spend. Dollar omission **local-only until separately approved release**; emptied dollar-only claims are dropped (not restored). | Navy parent-service $ ≠ NAVSEA command $. |
| 5 | `get_agency_spending_detail` | Navy FY2025 | **fixed** | Round PDF claims; **execution date/commit unknown**. Not re-run in agent recheck. | Navy ≠ DoD (prior). |
| 6 | `lookup_federal_osbp` | USCG | **fixed** | **developer-verified** + **agent-rechecked** | Same USCG OSBP mailbox. |
| 7 | `get_keyword_coverage` | `"patrol"` | **fixed** | Round PDF cited **~$6.67B / 106 NAICS** historically. That figure does **not** independently validate today’s ~**$903M** contract/BQ measurement. **Current figure not independently revalidated in this pass.** | Do not equate old and new patrol totals. |
| 8 | `search_past_contracts` | `336612` | **fixed** (attribution) | **developer-verified** + **agent-rechecked** | **Limitation:** empty USASpending source columns. |
| 9 | `build_pursuit_dossier` | `N00024-26-R-2200` | **fixed** | **developer-verified** + **agent-rechecked** | Compact dossier + `_meta.omitted`. |
| 10 | `get_solicitation_incumbent` | `N00024-26-R-2200` | **fixed** | **developer-verified** + **agent-rechecked** | Lot deadline conflict. |
| 11 | `extract_statement_of_work` | `N00024-26-R-2200` | **fixed** (disclosure) | **developer-verified** + **agent-rechecked** | **Limitation:** PIEE auto-extract unsupported. |
| 12 | `get_solicitation_documents` | sol + UUID | **fixed** (identity) | **agent-rechecked — split** | **Identity passed; retrieval incomplete** (empty body / 429). |
| 13 | `referee_proposal_compliance` | 17 req / ~15k draft | **fixed** (prior) | **Unverified in this pass.** Prior developer result = historical only. | Missing original payload. |
| 14 | `lookup_sam_entity` | Monarch Yachts | **reconciled** | Round 3 PDF claims; **execution date unknown**. **Agent-rechecked.** | Honest miss + reconciliation. |

## Scorecard (do not misread)

| Round | Retestable items the PDF *claims* | Independently proven with recorded UTC + serving commit | Not Round-PDF retested |
|---|---|---|---|
| Round 1 | partial | **none proven here** (date/commit unknown) | most |
| Round 2 | claims several; **missed SCIF** | **none proven here** (date/commit unknown) | #3, #6, #8–#13 + SCIF |
| Round 3 | claims #4+#14 newly; “6 of 6 retestable” scorecard | **none proven here** without recorded UTC+SHA in-PDF | #3, #6, #8–#13; **no fresh SCIF** |

Agent recheck closed many live-input items but **does not close the audit**. Outstanding: #13 unverified this pass; #12 retrieval incomplete; #4 dollar omission awaits separately approved public-domain release verification; Round-PDF independence remains under-documented on date/commit.

## Distinctions (not open bugs)

- **#8:** attribution honesty fixed; missing USASpending source columns remain a data limitation.
- **#11:** PIEE disclosure fixed; automatic PIEE extraction remains unsupported.
- **#12:** report **identity passed; retrieval incomplete** — do not call the issue fully passed.
- **#4 follow-up:** unsourced LEGACY_MANUAL `$` omitted; dollar-only claims emptied → **omitted** (never restored via `out \|\| text`).
- **#14:** zero hits = unsupported prior claim / honest miss — not proof of nonregistration forever.
- **#7:** historical Round patrol total ≠ current ~$903M measurement.

## Still open (audit not fully closed)

- **#13** — unverified this pass (payload missing).
- **#12 retrieval** — incomplete under 429 / empty description.
- **#4 dollar omission on public aliases** — verify only after a separately approved release of this PR.
- **Round-PDF independence** — needs recorded execution UTC + serving commit before “independently verified” labels harden.

## Not reopened

Pricing, credits, backfills (`--go` writer, 3,729-family, 44,560 fleet), PAE, #1560, agency-identity architecture beyond NAVSEA grain already shipped.
