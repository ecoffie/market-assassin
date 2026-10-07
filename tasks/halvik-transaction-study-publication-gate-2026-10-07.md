# Mindy Institute Release 001 — publication gate (2026-10-07)

Release 001 = **Research Standard v1** + **Transaction Study 001 (Halvik / Tetra Tech)** + the narrow truth cleanup
of existing Institute pages.

**Gate verdict: READY.** It needs Eric's explicit approval before merge. Merging the PR publishes the release, because main auto-deploys.

Nothing has been pushed, merged, deployed, posted or sent. Branch: `research/halvik-transaction-study` (local only).

## 1. Release contents

| Item | URL | State in branch |
|---|---|---|
| Research Standard v1 | `/research/standard` (static) | new page |
| Transaction Study 001 | `/research/halvik-tetra-tech` (registry RES-004, `published`) | serves once merged and deployed |
| RES-003 correction | `/research/small-business-participation-benchmark` | v1.0 → **v1.1**, with a dated correction shown on the page |
| Truth cleanup | `/research`, `/research/about`, `/research/how-we-publish`, `/institute/competition-gap` footer, `competition-health.ts` header | narrow copy and comment edits |
| Distribution drafts | `tasks/halvik-transaction-study-distribution-drafts-2026-10-07.md` | prepared, **not sent** |

## 2. Brand architecture (locked) and how the release reflects it

- **The Mindy Institute** is the research institution. Its public line is "independent research and measurement of the public procurement economy" (Standard page, RES-003 footer, study footer, backlog footer).
- **Mindy** is the data and evidence engine. It is named as the engine and is never presented as the source of truth (Standard principle 15).
- **GovCon Giants** is practitioner media, education and advisory. The distribution drafts explain the study and link to it. It is not the source of figures.
- **Eric Coffie** is the public interpreter and presenter. His LinkedIn draft attributes the work to the Institute.
- **Mindy for Government (getmindy.ai/gov)** is the government-facing application. Nothing here changes it.
- **No "GovCon Giants Institute" and no "think tank."** A grep of this repo found neither. A test now pins that across the research surfaces.
- The Standard discloses the conflict of interest: the Institute is operated by GovCon Giants AI, which also sells Mindy.
- **Replaced:** "the research arm of Mindy" in the RES-003, study and backlog footers. It made the Institute subordinate to the product.

## 3. Truth cleanup: verified against main `ca4634fd`, then corrected

| # | Public statement | What the code actually does | Correction |
|---|---|---|---|
| 1 | RES-003 "derived directly from two production metrics … OBS-001 and OBS-002"; "Cites OBS-002" chip; citation "(OBS-001, OBS-002)"; registry `citesMetrics: ['OBS-001','OBS-002']` | `computeSbBenchmark` reads only `sam_opportunities.department, set_aside_code`, which is OBS-001. OBS-002 is never computed. | Cites OBS-001 only. Version → v1.1. A **visible dated correction** states the original claim, what changed (no figure changed) and why. |
| 1b | RES-003 shows "Edition 2026 · v1.0 · Generated {today}" as if it were a dated edition | `force-dynamic`: recomputed on every request. No stored snapshot exists. | Chip now reads "Live · computed {date}". Added a disclosure box near the top: "A live benchmark, not a frozen edition … cite the computed date." The citation string now includes the computed date. **Not frozen.** That needs the Research Snapshot engine, which is out of scope. Registry `measurement: {mode:'live'}`. |
| 2 | `/research/about` "computed live" | This was only a **code comment**. The page is `force-static` and its counts come from code registries at build time, so they are exact as of each deploy. The public text was already accurate. | Comment corrected. Separately, the About **charter rule 1**, "every published claim traces to one or more Observatory standards", would have made the Halvik study non-compliant. It is narrowed to "traces to a defined measure: an Observatory standard, or a methodology published with the study itself". |
| 2b | `/research` hero and meta description: "Every figure is derived from **live** federal data" | False for a frozen historical study, and arguably for a static build. | Changed to "derived from federal data and dated." The research-class blurb changed from "Interpret several standards" to "Interpret measured evidence", and the intro links the Standard. |
| 3 | `competition-health.ts` header: "sam_opportunities + recompete_opportunities + BigQuery awards" | No BigQuery query. The third source is a cached USASpending per-award detail sample (`competition-depth.ts`). | Header comment corrected. This was internal only; no public page repeated the claim (grepped `/gov`, `/research`, `/institute`). |

**Not changed (out of scope, logged):** /gov's FY2023 $178.6B and BPC figures (strategy doc §9), OBS-003/OBS-004 limitation text, and the how-we-publish `cited[0].name` field mismatch.

## 4. Transaction and announcement dates: verified

| Concept | Date | Primary evidence (verified by me) |
|---|---|---|
| Acquisition / transaction date | **2026-01-16** | Tetra Tech 10-Q for the quarter ended 2025-12-28, filed **2026-01-30** (accession 0000831641-26-000005), Subsequent Event: *"On January 16, 2026, we acquired Halvik Corp."* Read in the filing text. |
| Public announcement date | **2026-01-22** | Tetra Tech investor-relations page, **opened in a browser 2026-10-07**: dated January 22, 2026; *"announced today that it has acquired Halvik Corp"*; *"The terms of the acquisition were not disclosed."* |
| Historical cutoff | **2026-01-21** | The study reconstructs what was publicly knowable immediately before the announcement. |
| Actions between acquisition and cutoff | 2, both $0 | `1333BJ24F00000001` P26013 and `GS35F328BA` PS0033, both dated 2026-01-21. Every figure is identical under a 2026-01-15 cutoff. Disclosed on the page and tested. |

The January 16 date is used only to describe the transaction. **No recertification conclusion is drawn.** It remains an input for the separate recertification workstream (rule T2), and that question is for counsel.

## 5. Final material-claim ledger

**Definitions used in this ledger:**
- **Source type:** P = primary, S = secondary.
- **Raw CSV:** `Contracts_PrimeTransactions_2026-10-07_H07M45S34_1.csv` (sha256 `5abd49c7f33b2614…`, full hash in `halvik-tetra-tech.data.json`), from USASpending download `PrimeTransactionsAndSubawards_2026-10-07_H07M45S24618047.zip`, retrieved 2026-10-07.
- **Included action:** `action_date ≤ 2026-01-21` AND (`initial_report_date` empty OR ≤ 2026-01-21), filtered to `recipient_uei = VMRTJLWMQRH7`.
- **Verified:** recomputed by me from the raw CSV, independently of `src/lib/diligence/*`, and agreeing to the cent with the pipeline register; or, for documents, read in the primary text.

### 5a. Headline and material quantitative claims

| Claim | Source | Type | As-of | Calculation | Verified? | Safe? | Notes |
|---|---|---|---|---|---|---|---|
| Headline: "$210 Million Acquisition" | 10-Q q/e 2026-03-29, Note 4 | P (SEC) | 2026-03-29, filed 2026-05-01 | quoted: "fair value of the purchase price was approximately $210 million" | Yes | Yes | Preliminary fair value, not cash paid. Appears only in the "Subsequently reported" block and the title |
| 245 prime awards and vehicles at cutoff | Raw CSV | P | 2026-01-21 | distinct `contract_award_unique_key` with ≥1 included action | Yes | Yes | |
| 215 contracts/orders + 30 vehicles | Raw CSV | P | 2026-01-21 | key prefix `CONT_AWD` vs `CONT_IDV` | Yes | Yes | |
| 253 listed / 253 downloaded | scorecard live listing vs download | P | 2026-10-07 | set comparison | Yes (scorecard) | Yes | COMPLETE |
| $724,711,413.15 cumulative obligations | Raw CSV | P | 2026-01-21 | Σ `federal_action_obligation`, included actions | Yes | Yes | Includes $2,500 on the OASIS+ vehicle itself, disclosed |
| 148 later actions + 1 late-reported excluded; 8 awards entirely after cutoff | Raw CSV | P | 2026-10-07 | complement of the inclusion rule | Yes | Yes | Max included action date and report date are both 2026-01-21 (tested) |
| FY2017 $3,072,854 → FY2025 $186,733,085; rises every year FY17–FY25 | Raw CSV | P | 2026-01-21 | Σ obligations by federal FY of `action_date` | Yes | Yes | FY2026 partial, marked |
| 92.6% associated with SB / 8(a) / WOSB set-aside classifications | Raw CSV | P | 2026-01-21 | Σ obligations of the 215 contracts whose set-aside (own, else parent vehicle's) is SB total/partial, 8(a) SS/competed, or WOSB/WOSB-SS ÷ $724,711,413.15 = 45.67% + 34.13% + 12.84% | Yes | Yes | Wording fixed to "associated with awards recorded under …". Parent fallback used for 138/215, disclosed. Denominator includes the $2,500 vehicle obligation |
| 7.0% no set-aside; 0.4% not recorded (1 award, $2.69M) | Raw CSV | P | 2026-01-21 | same | Yes | Yes | |
| Four departments = 94.1% | Raw CSV | P | 2026-01-21 | Σ obligations for DoD, DOT, DOC, NASA (awarding agency) ÷ total | Yes | Yes | Denominator = cumulative total, stated on the page |
| Orders under the five largest vehicles = 78.0% | Raw CSV | P | 2026-01-21 | Σ obligations of contracts whose `parent_award_id_piid` ∈ {693JJ319A000013, 47QRAD20D8115, W52P1J18DA078, 1333BJ21D00280002, 47QRAD20D1046} ÷ total | Yes | Yes | Wording: "orders under". Standalone contracts excluded from the ranking |
| Largest order (NASA 80TECH22FA001) = 15.8% | Raw CSV | P | 2026-01-21 | $114,250,000 ÷ total | Yes | Yes | |
| Top 5 awards 44.1%; top 10 55.6% | Raw CSV | P | 2026-01-21 | award obligations sorted descending | Yes | Yes | |
| TTM $169,186,988.88; DoD 37.2%, DOT 22.2%, NASA 20.2%, DOC 20.1%; top-4 99.7% | Raw CSV | P | window 2025-01-22..2026-01-21 | Σ in window | Yes | Yes | The window starts 01-22 (a $16.08M action sits on 2025-01-21) |
| 46 active; $547.2M obligated; $795.5M ceiling | Raw CSV | P | 2026-01-21 | active = latest POP current end recorded by the cutoff ≥ cutoff; ceiling = Σ per-action `base_and_all_options_value` | Yes | Yes | Ceiling ≠ backlog, stated |
| 21 of 46 reach potential end ≤ 2027-01-21, holding $327.6M (59.9%) | Raw CSV | P | 2026-01-21 | latest `period_of_performance_potential_end_date` | Yes | Yes | Worded as "options run out", not "work ends" |
| CO size determination 23 small / 23 other than small | Raw CSV | P | 2026-01-21 | latest included action of the 46 | Yes | Yes | Descriptive |
| 136 of 245 carry an 8(a) classification; 16 of 30 vehicles are set-aside/reserved MACs | Raw CSV | P | 2026-01-21 | set-aside codes containing 8A/8(A); vehicle set-asides | Yes | Yes | |
| First / latest award with 8(a) classification: 2017-02-09 / 2024-12-19 | Raw CSV | P | 2026-01-21 | min/max first-action date | Yes | Yes | |
| SP Systems: 71 awards, $51.8M, separate | Raw CSV | P | 2026-01-21 | `recipient_uei = GBNYDRT5ZZ53` | Yes | Yes | Never combined (tested) |
| 35 prime-reported subawards | scorecard | P | 2026-01-21 | subaward rows ≤ cutoff | Yes (scorecard) | Yes | PARTIAL by nature |

### 5b. Transaction facts (all "subsequently reported" except the dates)

| Claim | Source | Type | As-of | Verified? | Safe? | Notes |
|---|---|---|---|---|---|---|
| Acquired 2026-01-16 | 10-Q q/e 2025-12-28 | P | filed 2026-01-30 | Yes | Yes | |
| Announced 2026-01-22, "has acquired", terms not disclosed | IR page | P | 2026-01-22 | **Yes, browser** | Yes | |
| $150M cash; $25M escrow; $35M earn-out FV; maximum $97M over 3 years on operating-income targets | 10-Q Note 4 | P | 2026-03-29 | Yes | Yes | |
| $24M net tangible; $26M intangibles; $160M goodwill; preliminary | 10-Q Note 4 | P | 2026-03-29 | Yes | Yes | |
| 600 employees; Government Services Group | 10-Q Note 4; IR page | P | 2026 | Yes | Yes | |
| No Halvik revenue, operating income or backlog disclosed | 10-Q Q2 FY26 | P | 2026-03-29 | Yes | Yes | |
| Goodwill tax-deductible | 10-Q "fiscal 2026 goodwill addition" | P | — | Doesn't name Halvik | **No** | Omitted |
| Headquarters | 10-Q "Vienna" / IR "Tysons" / site "McLean" | P | — | Conflicting | **No** | Omitted |
| Stock vs asset purchase | — | — | — | Not stated | Not claimed | The page says "not stated" |

### 5c. History, 8(a) and public assertions

| Claim | Source | Type | Verified? | Safe? | Notes |
|---|---|---|---|---|---|
| Founded 2007 / SAM start date 2007-09-26 | halvik.com; SAM.gov | P | Yes | Yes | Attributed |
| SP Systems acquired July 2016; "an 8(a) certified" company | PR Newswire 2016-07-12 | P | Yes | Yes | Quoted |
| **8(a) entry 2015-03-27 / graduation 2024-01-23** | HigherGov profile | **S** | **No** (SBA unconfirmed; inconsistent with a 9-year term) | **No** | Omitted; page says "not established". Not in headline |
| 17 of 17 named vehicles found; 11 with orders by cutoff | halvik.com (10 undated), 2020 sheet, GSA eLibrary | P / S | Yes (recompute) | Yes | Undated pages don't matter: each vehicle is verified against the record |
| NASA SITSS $148.8M ↔ ceiling $148,756,175 (−0.03%), $114.25M obligated | NASA release C21-033 | P | Yes | Yes | |
| Army G-4 ~$62M | PR Newswire 2021-08-17 | P | — | Yes, **as UNRESOLVED** | Candidate W52P1J21F0063, 7 months earlier; not picked |
| Army CCSA ~$34M | battle-updates.com | S | — | Yes, **as UNRESOLVED** | |
| USPTO "$250M in task orders" | halvik.com undated | P | — | Yes, **as UNRESOLVED** | USPTO IDIQ orders $95.7M obligated, stated as context |
| WT "$148.2M revenue TTM, 28% defense" | Washington Technology | S | Yes | Yes, as a different measure | |

### 5d. Required checks

| Requirement | Result |
|---|---|
| 100% of headline/material quantitative claims accounted for | **Yes** (5a–5c) |
| No future-data leakage | **Pass.** Max included action and report date 2026-01-21. Post-cutoff 10-Q facts are confined to the labeled block (tested) |
| No stale ceiling field | **Pass.** The renderer source never references `potential_total_value` (tested). Vehicle ceilings are UNKNOWN and never shown |
| No obligations described as revenue | **Pass** (tested) |
| No potential value described as backlog | **Pass** (tested) |
| No silent affiliate combination | **Pass** (tested) |
| No unsupported 8(a) dates | **Pass** (tested) |
| No legal eligibility conclusions | **Pass.** Uses the prescribed recertification sentence (tested) |
| Unresolved assertions visibly unresolved | **Pass:** 3 unresolved (tested) |

## 6. Tests

| Test file | Covers |
|---|---|
| `src/lib/analytics/research-standard.unit.test.ts` (new) | 15 principles; completeness statuses and terminology; `/research/standard` route renders all principles and brand roles with no think-tank language; linked from /research, About, how-we-publish and the sitemap; **registry enforcement** (every published entry has standard v1, version, publish date, measurement mode, corrections, a permanent year-free URL); frozen as-of ≤ measured date; RES-004 URL; slug uniqueness and no collision with static pages; all truth-cleanup assertions |
| `src/lib/analytics/transaction-studies/halvik-tetra-tech-html.unit.test.ts` (rewritten) | Material figures (13 on-page needles); computed 92.6%; historical cutoff and future-data exclusion; the $0 acquisition-to-cutoff window; revenue/backlog/loss/eligibility language; subsequently-reported containment; no 8(a) dates; no affiliate merge; no stale ceiling field; 3 unresolved claims; the can/cannot box; fact/derived/interpretation labels; Standard link; draft noindex vs published index; phone-width layout (viewport, every table in a scroll wrapper, single-column breakpoint); canonical URL |
| `src/lib/analytics/res003-source-control.unit.test.ts` (updated) | RES-003 still published at its URL; **RES-003 is the only live publication**; every other published study is frozen |

**Results:**
- New and updated test files: **56/56 pass**.
- All 87 existing test files that touch research, sitemap, benchmark, Competition Health or institute: **1,237/1,237 pass**.
- `tsc --noEmit`: clean.
- Phone-width render check (headless Chrome, 390px and 1200px): study and Standard page have `scrollWidth` equal to the viewport, with no horizontal scroll.

## 7. Remaining human approvals

1. **Eric approves publication** of Release 001: the Standard, Study 001 and the RES-003 v1.1 correction together.
2. **Read-through of the wording** (`~/Documents/halvik-transaction-study-DRAFT-2026-10-07.html` and `~/Documents/mindy-institute-research-standard-v1-PREVIEW-2026-10-07.html`). Figures are final.
3. **Distribution sign-off**, after the study is live.

## 8. Exact publication sequence (after approval)

1. In `src/lib/analytics/research-publications.ts`, set `RELEASE_001_DATE` to the actual release date. It is RES-004's publish date and the date of RES-003's correction. Commit.
2. `npm run test:pre-deploy` and the pre-push gate. Push the branch and open a PR. *(The repo is public: pushing exposes the study text before publication. Push only on the release day.)*
3. Merge the PR. Main auto-deploys to getmindy.ai.
4. Wait for Vercel READY, then verify on the **live** URLs with `curl --compressed -L`:
   - `/research/standard` → 200, contains "Research Standard v1" and all 15 principle titles.
   - `/research/halvik-tetra-tech` → 200, contains "$724,711,413.15", `index,follow`, canonical, and **no** "Draft for internal review".
   - `/research/small-business-participation-benchmark` → 200, contains "A live benchmark, not a frozen edition" and the v1.1 correction, and **no** "Cites OBS-002".
   - `/research` → lists RES-004 under Research and no longer says "live federal data".
   - `/sitemap.xml` contains `/research/standard` and `/research/halvik-tetra-tech`.
5. Only then: GovCon Giants LinkedIn → Eric LinkedIn → newsletter → YouTube → podcast, each linking to the study.

## 9. Files

- `src/lib/analytics/research-standard.ts` (new): Standard v1 as versioned data
- `src/app/research/standard/route.ts` (new): the Standard page
- `src/lib/analytics/research-publications.ts`: Standard fields, `RELEASE_001_DATE`, RES-003 v1.1 + correction, RES-004
- `src/lib/analytics/sb-benchmark-html.ts` and `src/app/research/[slug]/route.ts`: RES-003 correction, live disclosure, corrections log; Halvik route branch
- `src/app/research/route.ts`, `src/app/research/about/route.ts`, `src/app/research/how-we-publish/route.ts`, `src/app/sitemap.ts`, `src/app/institute/competition-gap/route.ts`, `src/lib/analytics/competition-health.ts`: truth cleanup and links
- `src/lib/analytics/transaction-studies/halvik-tetra-tech{.data.json,.facts.ts,-html.ts,-html.unit.test.ts}`: the study
- `scripts/render-halvik-study-preview.ts`: draft preview (noindex)
- `tasks/halvik-transaction-study-publication-gate-2026-10-07.md` (this file) and `tasks/halvik-transaction-study-distribution-drafts-2026-10-07.md`
- The original workbook `~/Documents/halvik-contract-register-as-of-2026-01-21.xlsx` is untouched.
