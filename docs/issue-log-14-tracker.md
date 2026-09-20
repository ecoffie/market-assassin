# Issue-log 14-item tracker (NAVSEA / Monarch / matrix / spend)

Verification has **four** layers. Do not collapse them. **This audit is not fully closed.** Do **not** claim 14/14 closure.

| Layer | Meaning |
|---|---|
| **Developer-verified** | Closed by our live tool runs / fixtures on a named serving commit (includes the honesty PRs #1565 / #1571 / #1572 / #1575). Historical — does not substitute for a fresh recheck. |
| **Independently verified** | Confirmed by an external retest PDF **with a recorded execution time and serving commit**. PDF *upload* / file mtime / cover-date alone do **not** establish either. |
| **Agent rechecked** | Fresh tool runs in this follow-up (UTC timestamps below) against production aliases and/or the local worktree. Not a Round PDF. Not independent acceptance. |
| **Documented limitation** | Expected honest miss or upstream gap — not an open product bug. |

## Production serving (measured)

| When (UTC) | Alias evidence | Deploy | Git |
|---|---|---|---|
| 2026-09-20T18:54Z (agent recheck) | `maps-account-build:5cc700d79517687a934867c7244ec8d4bd8f994e` on `https://getmindy.ai/` | `dpl_DE5v71VKaWFaq6J9UXL8omhYEWFm` (Ready; aliases include `getmindy.ai` / `mcp.getmindy.ai`) | **`5cc700d7`** (#1576) |

PR #1577 worktree head at closeout push: see latest commit on `fix/navsea-priority-dollars-and-tracker` (starts from reviewed `f4bf5d0b`). **Not on public aliases until a separately approved release.**

Do not assume an older commit remains production. Re-measure.

## Independent retest record (external PDFs)

**Caveat:** Round PDF cover dates and upload/file mtimes are **not** execution timestamps. Unless a PDF records wall-clock UTC and the production serving commit, those fields stay **unknown**.

| Round | PDF artifact | Execution date (UTC) | Serving commit | What the PDF itself claims | Caveats |
|---|---|---|---|---|---|
| Round 1 | `0920 Mindy_MCP_Retest_Results.pdf` (body cites 18 Sep issue log) | **unknown** | **unknown** | Scorecard progress toward retestable items; includes early SCIF discussion | Upload/mtime ≠ execution. Do not treat as proof of a named prod SHA. |
| Round 2 | Round 2 PDF (header “18 September 2026”) | **unknown** | **unknown** (PDF cites post-#1571 / `73b607cb` era work — **not measured here**) | Contacts / Navy spend / keyword / related items among the “retestable” set | **Missed SCIF** — Round 2 did not confirm SCIF recovery. |
| Round 3 | Round 3 PDF (header “18 September 2026”; file mtime ~2026-09-20 12:43 local) | **unknown** | PDF *names* `6b14507f` — **not re-measured in this pass as Round-3 serving proof** | Newly: #4 NAVSEA identity/spend grain; #14 Monarch reconcile. Scorecard “6 of 6 retestable” across rounds | **Did not freshly verify SCIF.** Did not retest #3, #6, #8–#13. |

Prior developer honesty retest (not independent): serving commit `15c6b861` · deploy `dpl_3qA6JSAwyJwYUPyAHkRPXsiZqQTM` · PR #1572 · prior merge `73b607cb` (#1571).

## Corrected diff review (`f4bf5d0b`)

Reviewed before closeout work:

| Check | Result |
|---|---|
| Empty dollar-only LEGACY_MANUAL claims | Remain empty; loaders `if (!claim) continue` — no `out \|\| text` restore |
| Sourced dollar amounts (SOURCE_FACT) | Unchanged |
| Tracker layers | Distinguishes historical / agent recheck / independent / unresolved limitations |

## Agent recheck wave 1 (2026-09-20T18:54:52Z → 18:56:12Z UTC)

**Method:** OAuth MCP session against `https://mcp.getmindy.ai/mcp` on serving commit **`5cc700d7`**, plus local worktree for #4 dollar-omission. Artifact: `tasks/issue-log-14-recheck-2026-09-20.json`. Script: `scripts/issue-log-14-recheck.mjs`.

## Agent verification wave 2 (2026-09-20T19:29Z → 19:31Z UTC) — closeout

**Method:** Local worktree (post-`f4bf5d0b` + noticedesc failover). **Agent verification only — not independent acceptance.**

| # | Exact input | Expected | Observed | Env / commit | Evidence | Remaining limitation |
|---|---|---|---|---|---|---|
| 1 SCIF + five named specs | `extract_compliance_matrix` `notice_id=6552b25bf0e648f39b44228275998eef` | SCIF + loa_range, flight_deck, berthing, magazine present in matrix/source path | **PASS (agent)** — 51 rows; all five named specs hit; `grounded=true`. Named-spec presence ≠ full-document completeness. | local worktree @ closeout | `tasks/issue-log-14-scif-agent-2026-09-20.json` | Round-PDF SCIF independence still not established |
| 7 patrol | `keywordCoverage("patrol")` current FY2025 BQ | Honest current total; not Round PDF figure | **PASS (agent)** — **~$902.6M** / **121 NAICS**; top 336611 ~78.6%; PSC 1905. Historical Round ~$6.67B/106 **not** validated here. | local worktree @ closeout | `tasks/issue-log-14-patrol-agent-2026-09-20.json` | 1-FY window vs marketing/3-FY contract drift |
| 12 identity + retrieval | `get_solicitation_documents` `N00024-26-R-4160` **and** UUID `85a62e9a3f4f4f54b0ade7aa855fcc89` | Same resolved notice; body from cache or noticedesc; honest miss if upstream blocked | **Split:** identity **PASS** (both → `85a62e9a…`). Retrieval **INCOMPLETE** — DB description empty; `pursuit_documents=0`; `mcp_external_cache` miss; **both** configured SAM keys **noticedesc 429**. Failover tried 2/2; `retrieval_limitation` disclosed. No content invented. | local worktree @ closeout | `tasks/issue-log-14-noticedesc-probe-2026-09-20.json` | **Upstream quota** — code fix (multi-key + persist + disclosure) shipped in PR; body still empty until a key succeeds or cache is warm |
| 13 referee | Original 17-req / ~15k draft | Exact-input retest | **Original exact-input retest unavailable** (not in repo/tasks/attachments/transcripts). **Labeled representative regression only:** 17 synthetic reqs, 1837-char draft → grounded, score 38, 13 partial / 4 missing, no timeout. **Do not present as original.** | local worktree @ closeout | `tasks/issue-log-14-referee-representative-2026-09-20.json` | Missing original payload |

## Agent verification wave 3 (2026-09-20T19:41Z → 19:42Z UTC) — disclosure + merge + unfinished checks

**Method:** Local worktree after merge of `origin/main` + noticedesc disclosure pass. **Agent verification only.**

| # | Exact input | Expected | Observed | Evidence | Remaining limitation |
|---|---|---|---|---|---|
| 5 Navy FY2025 | `get_agency_spending_detail` `{ agency: "Navy", fiscal_year: 2025 }` | Navy ≠ DoD total; scope/percentage honesty; set-aside share ≠ SBA goaling | **PASS (agent)** — agency `Department of the Navy`; scope `REQUESTED`; total **~$176.6B**; toptier `097` = DoD parent code (not “all of DoD”); `small_business_share`/`set_aside_share` **3.4%**; `recipient_small_business_share` **12.5%**; grounded | `tasks/issue-log-14-navy-fy2025-agent-2026-09-20.json` | Round-PDF independence still unknown |
| 12 required retrieval recheck | sol + UUID as above | **Successful** body retrieval (required for #12 audit closure) | **FAIL for closure** — `retrieval_success: false`; both inputs still empty; all-key **429 (quota)** with per-key disclosure. Disclosure PASS ≠ retrieval proof. | `tasks/issue-log-14-noticedesc-recheck-2026-09-20.json` | **#12 cannot close** until a non-empty description is retrieved |
| 13 comparable-size representative | 17 req + ~15k draft (labeled, not original) | Exercise comparable draft size; keep original-unavailable label | **PASS (representative)** — checked_at **2026-09-20T19:42:36.160Z**; draft **14,343** chars; wall **8,009 ms**; grounded; score **24**; verdicts met 0 / partial 8 / missing 9 / unevaluated 0; timeout_trace timed_out=false (budget 45s, 2/2 batches). Input saved for future regressions. **Not** the original payload. | `tasks/issue-log-14-referee-15k-input-2026-09-20.json` + `…-result-2026-09-20.json` | Original exact-input: preserved **evidence limitation** (do not hold audit indefinitely) |

**Code this wave:** noticedesc tracks per-key outcomes; discloses network/timeout (no invented HTTP status), empty HTTP 200, and mixed 401+429 (credentials vs quota). Mocked execution tests cover failover success, all-key failure, timeout, empty body. Merge with `origin/main` resolved (`sourced-pain-points` keeps dollar-omit **and** unsupported-budget-claim guards).

## Release readiness vs audit gaps (do not collapse)

Reviewed head for release approval: **`73089220`**. CI (2026-09-20): `verify` **success**; Vercel status **success**; `live-smoke` / `maps-account-prod` **skipped** (PR path). PR `mergeable: true`, `mergeable_state: clean`. Focused unit recheck on this head: noticedesc failover + dollar-omit — **18/18 pass**.

| Bucket | Items | Blocks release? | Blocks audit closure? |
|---|---|---|---|
| **Release-ready code on this PR** | Dollar-omit (no restore); noticedesc failover + per-key disclosure; merge with main; #5/#7/#13 representative evidence | **No** — ready for Eric’s **separate** release approval | — |
| **Post-release verification** | Public-domain LEGACY_MANUAL `$` suppression on getmindy.ai / mcp aliases | Does not block merge decision once approved; **must** run after release | Yes until verified on public domains |
| **Open audit (track separately)** | **#12** successful same non-empty sourced description for sol + UUID | No (disclosure shipped; retrieval is upstream/audit) | **Yes** — disclosure alone does not close #12 |
| **Preserved evidence limitation** | **#13** original 17-req / ~15k payload lost | No | Original-input verification remains unavailable; **representative PASS** is the regression baseline going forward — do not hold the audit indefinitely for the lost payload |
| **Independent Round-PDF** | Recorded UTC + serving commit still unknown | No | Yes for “independently verified” labels |

**No merge or deployment is authorized by this tracker update.** Release requires Eric’s explicit approval after final review of `73089220`.

## Per-issue evidence ledger

For each original issue: exact input · expected · observed · tested commit/env · evidence · remaining limitation. Keep **code fix** / **upstream data gap** / **unsupported capability** distinct.

| # | Tool | Exact input | Expected behavior | Observed result | Tested commit / env | Evidence artifact | Remaining limitation |
|---|------|-------------|-------------------|-----------------|---------------------|-------------------|----------------------|
| 1 | `extract_compliance_matrix` | `6552b25bf0e648f39b44228275998eef` | Recover SCIF; five named specs present when in source | Agent PASS (wave1 on `5cc700d7` + wave2 local): specs present; ~51–52 rows | prod `5cc700d7` + local closeout | recheck JSON + `issue-log-14-scif-agent-2026-09-20.json` | Completeness ≠ full document; Round-PDF SCIF independence **not** established |
| 2 | `search_federal_contacts` | USCG + `small business` | USCG mailbox, not State | Agent PASS | prod `5cc700d7` | recheck JSON | Round-PDF date/commit unknown |
| 3 | `build_pursuit_dossier` | `N00024-26-R-2200` | Incumbent null; Mazak prior_awards only | Agent PASS | prod `5cc700d7` | recheck JSON | — |
| 4 | `get_agency_intel` | `"Naval Sea Systems Command"` | Honest spend grain; no unsourced priority `$` | Prod: identity/spend PASS; **still emits unsourced `$` until release**. Local: emptied dollar-only claims omitted (not restored) | prod `5cc700d7` + PR worktree | recheck JSON + sourced-pain-points tests | **Post-release check required** for public-domain `$` suppression |
| 5 | `get_agency_spending_detail` | Navy FY2025 | Navy ≠ DoD; honest scope/% | **Agent PASS** — Navy ~$176.6B REQUESTED; 097 parent code noted; set-aside 3.4% ≠ recipient SB 12.5% | local wave3 | `issue-log-14-navy-fy2025-agent-2026-09-20.json` | — |
| 6 | `lookup_federal_osbp` | USCG | Kersey-Robinson / uscg-smallbusiness | Agent PASS | prod `5cc700d7` | recheck JSON | — |
| 7 | `get_keyword_coverage` | `"patrol"` | Current BQ contract figure | Agent ~**$902.6M** / 121 NAICS (wave2). Round ~$6.67B/106 is **historical only** | local closeout | `issue-log-14-patrol-agent-2026-09-20.json` | Do not equate old/new totals; 1-FY measurement |
| 8 | `search_past_contracts` | `naics: "336612"` | Attribution honesty | Agent PASS | prod `5cc700d7` | recheck JSON | **Upstream:** empty USASpending source columns |
| 9 | `build_pursuit_dossier` | `N00024-26-R-2200` | Compact + `_meta.omitted` | Agent PASS | prod `5cc700d7` | recheck JSON | — |
| 10 | `get_solicitation_incumbent` | `N00024-26-R-2200` | Lot deadline conflict; no grounded incumbent | Agent PASS | prod `5cc700d7` | recheck JSON | — |
| 11 | `extract_statement_of_work` | `N00024-26-R-2200` | Disclose PIEE unread | Agent PASS (disclosure) | prod `5cc700d7` | recheck JSON | **Unsupported:** PIEE auto-extract |
| 12 | `get_solicitation_documents` | sol `N00024-26-R-4160` + UUID `85a62e9a…` | Shared identity; **same non-empty sourced description** (audit close requires success) | **Identity PASS**; **retrieval still open** (all-key 429). Disclosure PASS ≠ close. | local wave3 | probe + `issue-log-14-noticedesc-recheck-2026-09-20.json` | Keep open until both inputs return the same non-empty sourced body |
| 13 | `referee_proposal_compliance` | Original 17 req / ~15k draft | Exact-input retest | **Original unavailable** (preserved limitation). **Representative PASS:** 14,343 chars · 8,009 ms · 2026-09-20T19:42:36Z · score 24 · no timeout. Use saved input for future regressions. | local wave2+3 | `referee-15k-input/result` | Do not hold audit for lost payload |
| 14 | `lookup_sam_entity` | `"Monarch Yachts"` | Honest miss + reconcile | Agent PASS | prod `5cc700d7` | recheck JSON | Zero hits ≠ eternal nonregistration |

## Status by issue (summary)

| # | Fix status | Verification layer | Notes |
|---|------------|--------------------|-------|
| 1 | **fixed** | **agent-rechecked** (not independent SCIF) | Named specs present |
| 2 | **fixed** | agent-rechecked; Round date/commit unknown | — |
| 3 | **fixed** | developer + agent | — |
| 4 | **fixed** (+ dollar-omission in PR) | agent identity/spend; dollar omit **local until release** | Post-release public `$` check |
| 5 | **fixed** | **agent-rechecked** Navy FY2025 | Scope/share distinctions recorded |
| 6 | **fixed** | developer + agent | — |
| 7 | **fixed** | **agent-rechecked current ~$903M**; Round figure historical | — |
| 8 | **fixed** (attribution) | agent + **limitation** (empty source cols) | — |
| 9 | **fixed** | developer + agent | — |
| 10 | **fixed** | developer + agent | — |
| 11 | **fixed** (disclosure) | agent + **unsupported** PIEE extract | — |
| 12 | **fixed** (identity + failover/disclosure); retrieval **open** | agent — split; disclosure ≠ close | Audit: wait for same non-empty sourced body on both inputs |
| 13 | **fixed** (engine); original **unavailable** | **representative PASS** (14,343 / 8,009 ms); original limitation preserved | Future regressions use saved ~15k input |
| 14 | **reconciled** | agent | — |

## Scorecard (do not misread)

| Round | Retestable items the PDF *claims* | Independently proven with recorded UTC + serving commit | Not Round-PDF retested |
|---|---|---|---|
| Round 1 | partial | **none proven here** (date/commit unknown) | most |
| Round 2 | claims several; **missed SCIF** | **none proven here** (date/commit unknown) | #3, #6, #8–#13 + SCIF |
| Round 3 | claims #4+#14 newly; “6 of 6 retestable” scorecard | **none proven here** without recorded UTC+SHA in-PDF | #3, #6, #8–#13; **no fresh SCIF** |

**Audit is not 14/14 closed** (#12 retrieval open; Round-PDF independence weak). **Release readiness of `73089220` is separate** — see table above; awaiting Eric approval. No merge/deploy from this note.

## Distinctions (not open product bugs)

- **#8:** attribution honesty fixed; missing USASpending source columns = **upstream data gap**.
- **#11:** PIEE disclosure fixed; automatic PIEE extraction = **unsupported capability**.
- **#12:** identity passed; retrieval **remains open for audit** until sol + UUID return the **same non-empty sourced description**. Disclosure alone does not close it.
- **#4 follow-up:** unsourced LEGACY_MANUAL `$` omitted locally; **verify on public domains after approved release**.
- **#14:** zero hits = unsupported prior claim / honest miss — not proof of nonregistration forever.
- **#7:** historical Round patrol total ≠ current ~$903M measurement.
- **#13:** original exact-input unavailable (preserved evidence limitation). Comparable-size representative **passed** (14,343 chars, 8,009 ms, 2026-09-20T19:42:36Z) — that is the regression baseline; do not hold the audit indefinitely for the lost payload.

## Still open — audit gaps (track separately from release)

- **#12 retrieval** — open until both inputs return the same non-empty sourced description.
- **#4 / dollar suppression** — public-domain check **after** approved release only.
- **Round-PDF independence** — needs recorded execution UTC + serving commit for “independently verified” labels.
- **#13 original payload** — preserved limitation only; representative regression is the forward path.

## Post-release checks (do not skip)

1. **Public-domain suppression of unsourced priority dollars** — after separately approved release of PR #1577, call `get_agency_intel` for `"Naval Sea Systems Command"` on **production aliases** and assert LEGACY_MANUAL priority claims contain **no** `$` / `Allocated $…` while qualitative non-dollar priorities remain and SOURCE_FACT dollars (if any) stay.
2. Re-measure serving commit on `getmindy.ai` / `mcp.getmindy.ai` before treating release as live.
3. **#12 (audit, not release gate):** when SAM noticedesc quota recovers (or a cached description exists), re-run sol + UUID for `N00024-26-R-4160` and confirm both return the **same non-empty sourced** description before calling #12 closed.

## Not reopened

Pricing, credits, backfills (`--go` writer, 3,729-family, 44,560 fleet), PAE, #1560, agency-identity architecture beyond NAVSEA grain already shipped. No new collectors. No customer messages. **No merge or deployment authorized** until Eric explicitly approves release of `73089220`.
