# Target-centric diligence retrieval: Halvik before/after scorecard (2026-10-07)

**Target:** HALVIK, LLC · UEI `VMRTJLWMQRH7` · CAGE `5GRR4` · **as-of 2026-01-21** (the day before
Tetra Tech's announcement). Branch `feat/diligence-target-register`, not pushed or deployed. No MCP tool
was added, so the four-surface catalog is unchanged.

**What this is:** the public federal **prime** award record as it could be known on the as-of date.
**It is not revenue, not backlog, and not Halvik's contract register.**

## Scorecard

| Measure | Before (`get_contractor_award_history`) | After (target register) |
|---|---|---|
| Contract-grain rows | **21** (capped "recent awards" sample) | **245** Halvik awards and vehicles (215 contracts + 30 vehicles) + 71 SP Systems rows |
| Denominator | "246" (warehouse distinct award ids: contracts and vehicles mixed, all dates, including post-cutoff) | **253** listed by USASpending's award search (223 contracts + 30 vehicles); **245** admissible at the as-of date |
| Agreement with independent listing | not measured | **253 / 253 (100%)**; 0 missing either way |
| Coverage of admissible awards | 8.5% (21/246, wrong denominator) | **100% (245/245)** |
| As-of freeze | none (data as of 2026-09-25) | **yes**: latest included action **2026-01-21**; 148 post-cutoff actions and 8 post-cutoff awards excluded |
| Ceiling (base + all options) | not returned | **known on 100%** of contracts, summed from per-action option values |
| Instrument | parsed from the award id, type unknown | **established on 97.2%** (BPA / single- or multiple-award IDIQ / GWAC / GSA Schedule / standalone) |
| Name resolution | "Halvik Corp" → no result | "Halvik Corp", "Halvik", "HALVIK, LLC" and CAGE 5GRR4 all resolve uniquely to the UEI |
| Affiliates | not resolved | SP Systems, Inc. (`GBNYDRT5ZZ53`). It reports Halvik as parent on 110 actions (2016-08-04..2025-05-14); tagged, never merged |
| Subcontract work | absent | 35 prime-reported subawards with Halvik or SP Systems as the sub (Leidos, SAIC, CALIBRE, Salient, Booz Allen…). Incomplete by nature |
| Agency concentration | capped (5 or 8 of 15, inconsistent) | complete list, lifetime-to-as-of and TTM |

### Why "246" was the wrong denominator
- It counted **contracts and vehicles together**: 217 contract awards and 29 IDVs in the warehouse.
- It used **all dates**, including 8 awards that begin after the cutoff.
- The warehouse **starts in FY2016**, so it is missing **7 awards from 2014–2015**. They are now
  present via USASpending: 6 GSA Schedule / Commerce orders and 1 Commerce BPA.
- USASpending's award search lists **253** for this UEI, and the download agrees on every one.
- The correct as-of denominator is **245**: awards with at least one action dated and reported by 2026-01-21.

### Zero-leakage proof (strict mode)
- Every action must be **dated and reported** on or before 2026-01-21.
  - Dated after the cutoff: 148 actions excluded, including 8 whole awards.
  - Dated before but reported after (2026-03-02): 1 action excluded.
- The 260 actions that carry no report date are all dated **2007-10-02..2015-09-28**.
- Values never come from the award-level "current" columns. The parser doesn't read them, and a unit test asserts it.
- A POP extension signed after the cutoff can't move a POP end date; this is tested.
- `assertNoPostAsOfLeakage` runs before anything is written, and the script refuses to emit a register that fails it.

### Independent verification run
- **Arithmetic:** a raw recomputation from the CSV of Halvik obligations to the cutoff gives **$724,711,413.15**. The register sum is identical.
- **Workbook:** all 2,386 formula cells were stripped of cached values and **recalculated by LibreOffice**. All 316 register rows match the register on obligated, ceiling, status and action count, with **0 mismatches**.
- **Tests:** 17/17 unit tests pass. They cover as-of exclusion, report-date leakage, unknown staying null, partial sums, separating obligations from ceilings, dedupe, conflicting-duplicate fail-closed, affiliate tagging, instrument derivation, and parser fail-closed behavior.

## Public-assertion reconciliation (regenerated)

| Claim | Result |
|---|---|
| 17 contract vehicles Halvik names publicly | **17/17 found as vehicles held by Halvik.** 11 have orders by the as-of date; 6 have none (OASIS SB Pools 3 and 4, NOAA NMITS, OASIS+, FAA eFAST, FAA ITIPSS) |
| NASA SITSS, $148.8M potential (NASA release) | **Matched** `80TECH22FA001`. As-of ceiling $148,756,175 (−0.03%); $114.25M obligated by the as-of date |
| Army G-4 ~$62M and Army CCSA ~$34M (2021 releases) | **Unresolved.** Neither names a PIID. The only date-and-agency candidate is a $1.38M order, which both claims would share, so nothing is picked |
| USPTO BOSS "$250M in task orders" (undated page) | **Unresolved.** 21 candidate USPTO orders, and the claim names no PIID |
| Washington Technology TTM estimate $148.2M, defense 28% | Register TTM net **obligations** $169.2M (+14.2%), DoD share **37.2%**. These are different measures (obligations vs a revenue estimate), so this is context, not a tie-out |
| Tetra Tech 10-Q: ~$210M consideration, $160M goodwill | **Not reconcilable** from public award data. The 10-Q discloses no Halvik revenue or backlog, so this is **not an answer key** for the register |
| SP Systems acquisition (2016) | **Matched**: affiliate link in the federal record from 2016-08-04 |

**Answer-key limitation:** there is no arithmetic grade available for Halvik. The purchase price
allocation doesn't break out revenue or backlog. What *can* be graded is the reconciliation against
Halvik's own named vehicles and NASA's named award, and both tie.

## Descriptive facts surfaced (no conclusions drawn)
- **46 contracts were active at the as-of date.** Their combined as-of ceiling is $795.5M, of which $547.2M was obligated. This is ceiling not yet obligated; it is **not backlog**.
- **Instrument mix of Halvik's 215 contracts:** 94 orders under single-award IDIQs, 47 calls under multiple-award BPAs, 29 orders under multiple-award IDIQs, 15 standalone, 14 GWAC orders, 10 GSA Schedule orders, 6 not established.
- **The single-award IDIQs are four DOT vehicles Halvik holds**, each recorded as an 8(a) sole-source award. The workbook reports this and does not interpret it. Recertification consequences are out of scope by instruction.
- **TTM agency mix:** DoD 37.2%, DOT 22.2%, NASA 20.2%, Commerce 20.1%.

## Side finding (NOT fixed, out of scope)
- **USASpending's `potential_total_value_of_award` column is a stale snapshot** that differs row to row within one award. Measured on `H9240421F0077`: $76.2M on the row vs $93.4M live.
- **The warehouse ingests that column** as `awards.potential_award_value`.
- **Readers:** `src/lib/market/keyword-coverage-bq.ts` and `src/lib/mrr/office-awards.ts`. Any ceiling they display is suspect.
- The register uses the per-action `base_and_all_options_value` delta instead. Its sum equals the live award API exactly.
- Recommend a separate ledger entry and fix.

## Not built (by instruction)
Recertification conclusions, valuation, legal interpretation, CPARS, DCAA/CAS, price recommendations,
an MCP tool, and any deploy.

## Files
- `src/lib/diligence/transactions.ts`: the per-action row; the parser never reads current-state columns
- `src/lib/diligence/register.ts`: the pure as-of register and the leakage proof
- `src/lib/diligence/usaspending-source.ts`: the download and the independent listing, fail-closed with bounded retry
- `src/lib/diligence/completeness.ts`: reported subsidiaries and the completeness measurement
- `src/lib/diligence/register.unit.test.ts`: 17 tests
- `scripts/diligence/build-target-register.ts`: the orchestrator and workbook writer
- `scripts/diligence/fixtures/halvik-public-assertions.json`: claims, each with a source URL and source kind
- Run outputs (local only, NOT git-ignored — do not `git add -A`): `.claude/diligence/halvik/` (workbook, `register.json`, `scorecard.json`, `download.json`, `live-listing.json`)
