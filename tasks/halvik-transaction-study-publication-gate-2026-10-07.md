# Halvik / Tetra Tech — Transaction Study 001: publication gate (2026-10-07)

**Verdict: READY TO PUBLISH**, on two conditions:
- the headline **does not use "8(a)"** (see B1), and
- a human completes the three review items in §5.

Nothing has been published or deployed. Branch `research/halvik-transaction-study`, not pushed.

**Canonical placement:** `getmindy.ai/research/halvik-tetra-tech`. This is the existing `/research/[slug]` system; see §4 for why it is not under `/research/transactions/…`.

## 1. What changed from the existing work (read first)

Independent verification found two things the earlier register/scorecard work did not have:

1. **The deal closed 2026-01-16, five days before the study's 2026-01-21 cutoff.**
   - Source: Tetra Tech 10-Q for the quarter ended 2025-12-28, Subsequent Event: *"On January 16, 2026, we acquired Halvik Corp."* I verified this in the filing text myself.
   - 2026-01-22 is the **announcement** date, not the closing date.
   - Impact on the study: **none numerically.** Only two Halvik actions fall between 01-16 and 01-21, and both are $0 administrative modifications (`1333BJ24F00000001` P26013 and `GS35F328BA` PS0033). Every figure is identical whether the cutoff is the day before closing or the day before the announcement. The study discloses this.
   - **Impact on the separate recertification work: material.** `tasks/recert-review-rule-table-halvik-2026-10-07.md` lists the transaction date (T2) as *"UNKNOWN, and decisive"* and pivots on 125.12(g)'s 2026-01-17 threshold. The acquirer's own filing now gives 2026-01-16. That is an input for that workstream, **not a legal conclusion in this study**. Whether "acquired" in a 10-Q is the date the transaction "occurs" under 125.12(g) is a question for counsel.
2. **The 8(a) graduation date (2024-01-23) is secondary only.**
   - The only source is a HigherGov profile: "Graduated (March 27, 2015 - Jan. 23, 2024)".
   - SAM.gov's current record shows no SBA certification dates, and SBA DSBS returned a 503.
   - A nine-year term from 2015-03-27 would end around 2024-03-27, so the stated date is about two months early, unexplained.
   - **8(a) participation itself is primary-supported**: 136 awards and vehicles with an 8(a) basis in FPDS (8(a) sole-source awards require SBA program participation), 8(a) STARS II/III and the OASIS 8(a) subpool held, and Halvik's own July 2016 release ("an 8(a) certified" company). The **dates** are not.
   - The FPDS per-action "8(a) program participant" flag can't settle it either: it is still `t` on new awards in 2026.

## 2. Red-flag check (each would block)

| Red flag | Status |
|---|---|
| Cutoff leaks future data | **PASS.** Strict as-of: action date AND report date ≤ 2026-01-21; 148 later actions and 1 late-reported action excluded. Recomputed independently from the raw CSV (sha256 `5abd49c7…`). The study is a frozen snapshot that never queries live data. Closing-date nuance disclosed (§1.1). |
| Consideration not tied to primary filing | **PASS.** 10-Q Q2 FY26 Note 4, verified in the text. |
| 8(a) history not supportable | **PASS only because the dates are omitted.** It fails if the headline or body asserts entry/graduation dates. |
| Register completeness not defensible | **PASS.** 253/253 listed awards downloaded; 245 admissible; independent recompute matches to the cent. |
| Obligations described as revenue | **PASS.** A unit test asserts every "revenue" sentence is negated or attributed. |
| Potential value described as backlog | **PASS.** Same test for "backlog". |
| Affiliate awards silently combined | **PASS.** SP Systems ($51.8M, 71 awards) reported separately; a test asserts the combined figure never appears. |
| Unverifiable assertions as fact | **PASS.** G-4 / CCSA / USPTO shown as Unresolved; Washington Technology shown as a different measure. |
| Stale ceiling data | **PASS.** Ceilings are summed per-action `base_and_all_options_value` deltas. The `potential_total_value_of_award` snapshot column (which differs across rows on 78 Halvik awards) is never read. SITSS ceiling $148,756,175 vs NASA's $148.8M. |
| Legal consequence asserted | **PASS.** The study states only: "identifies the exposure but does not determine the post-acquisition eligibility consequence." A test asserts no lost/ineligible/terminated language. |

## 3. Claim ledger

Abbreviations:
- **P** = primary, **S** = secondary.
- **Raw CSV** = `Contracts_PrimeTransactions_2026-10-07_H07M45S34_1.csv`, from the USASpending download `PrimeTransactionsAndSubawards_2026-10-07_H07M45S24618047.zip`, retrieved 2026-10-07. Recomputed by `scratchpad/scripts/recompute.py` independently of `src/lib/diligence/*`.

### Transaction

| Claim | Source | As-of | P/S | Verified? | Safe? | Notes |
|---|---|---|---|---|---|---|
| Buyer Tetra Tech, Inc.; target Halvik Corp | 10-Q q/e 2026-03-29 Note 4 | filed 2026-05-01 | P | Yes (text) | Yes | |
| Acquired on 2026-01-16 | 10-Q q/e 2025-12-28, Subsequent Event | filed ~2026-02 | P | Yes (text) | Yes | Differs from the "announcement" framing; disclosed |
| Announced 2026-01-22, "has acquired" | Tetra Tech press release | 2026-01-22 | P | **Partial**: retrieved via WebFetch/Perplexity extract (Cloudflare blocked direct fetch); Washington Technology dated the same day | Yes, after a browser check | Review item R1 |
| Fair value of purchase price ≈ $210M | 10-Q Note 4 | 2026-03-29 | P | Yes (text) | Yes | Preliminary. In "Subsequently reported" block |
| $150M cash + $25M escrow + $35M earn-out FV | 10-Q Note 4 | 2026-03-29 | P | Yes (text) | Yes | The cash-flow statement shows $175.0M outflow (cash + escrow); not used |
| Earn-out maximum $97M, 3-year operating-income targets | 10-Q Note 4 | 2026-03-29 | P | Yes (text) | Yes | |
| $24M net tangible / $26M intangibles / $160M goodwill, preliminary | 10-Q Note 4 | 2026-03-29 | P | Yes (text) | Yes | |
| Goodwill tax-deductible | 10-Q: "fiscal 2026 goodwill addition is deductible" | 2026-03-29 | P | Text does not name Halvik | **No** | Removed |
| Government Services Group segment | 10-Q Note 4 | 2026-03-29 | P | Yes | Yes | |
| 600 employees | 10-Q Note 4 ("With 600 employees") | 2026-03-29 | P | Yes | Yes | Attributed to Tetra Tech's filings |
| No Halvik revenue / backlog disclosed | 10-Q Q2 and Q3 FY26 | 2026-03-29 / 06-28 | P | Yes (agent review of both) | Yes | The Q3 10-Q combines Halvik with Providence; not used |
| Stock vs asset purchase | — | — | — | Not stated anywhere | Not claimed | Study says it is not stated |
| HQ location | 10-Q "Vienna", release "Tysons", site "McLean" | — | P | Conflicting | **Not stated** | Omitted |

### Halvik history

| Claim | Source | As-of | P/S | Verified? | Safe? | Notes |
|---|---|---|---|---|---|---|
| Founded 2007 | halvik.com "Our Story"; SAM start date 2007-09-26 | undated / 2026-10-07 | P (company; federal) | Yes | Yes | Attributed ("Halvik says") |
| Acquired SP Systems, July 2016 | PR Newswire 2016-07-12 | 2016-07-12 | P | Yes | Yes | Federal parent link from 2016-08-04 (raw CSV) |
| Described itself as "an 8(a) certified" company in 2016 | same release | 2016-07-12 | P | Yes | Yes | Quoted |
| First award with 8(a) basis 2017-02-09 (DOT, DTOS5917D00504); latest before cutoff 2024-12-19 | Raw CSV | 2026-01-21 | P | Yes (recompute) | Yes | Basis = award or parent vehicle set-aside |
| 136 of 245 awards/vehicles carry an 8(a) basis | Raw CSV | 2026-01-21 | P | Yes | Yes | |
| 8(a) entry 2015-03-27, graduation 2024-01-23 | HigherGov profile | — | **S** | **No** (SBA unconfirmed; internally inconsistent with a 9-year term) | **No** | Omitted. **Blocks "From 8(a)" headline** |
| First prime action 2014-04-16 (GSA Schedule GS35F328BA) | Raw CSV | — | P | Yes | Yes | Download window starts FY2008 |
| Employee growth milestones | halvik.com timeline | undated | P (company) | Wayback check failed (429) | Not used | |

### Register and portfolio (all P, raw CSV, as-of 2026-01-21, verified by independent recompute)

| Claim | Value | Safe? | Notes |
|---|---|---|---|
| Awards listed / downloaded | 253 / 253 (223 contracts + 30 vehicles) | Yes | |
| Awards admissible at cutoff | **245** = 215 contracts/orders + 30 vehicles | Yes | 8 awards begin after cutoff |
| Actions included / total | 1,535 / 1,684 | Yes | 148 after cutoff; 1 reported after cutoff |
| Cumulative obligations FY2014–cutoff | **$724,711,413.15** | Yes | Includes $2,500 on the OASIS+ vehicle itself, disclosed |
| Annual obligations FY2014…FY2026 partial | FY17 $3.07M → FY25 $186.73M; rises every year FY17–FY25 | Yes | "Obligations", never revenue |
| TTM 2025-01-22..2026-01-21 | $169,186,988.88; DoD 37.2%, DOT 22.2%, NASA 20.2%, DOC 20.1% | Yes | Window label corrected: the scorecard said "2025-01-21..", but its figure excludes 01-21 (a $16.08M G-4 action sits on 2025-01-21) |
| Four departments' share, lifetime | 94.1% | Yes | |
| Set-aside basis: SB 45.7%, 8(a) 34.1%, WOSB 12.8%, none 7.0%, not recorded 0.4% | sum of reserved = 92.6% | Yes | Basis falls back to the parent vehicle for 138 of 215 awards; definition stated |
| Top five vehicles 78.0%; top award 15.8%; top 5 awards 44.1%; top 10 55.6% | | Yes | |
| 46 active at cutoff; $547.2M obligated; $795.5M ceiling | | Yes | Ceiling ≠ backlog, stated |
| 21 of 46 active reach potential end ≤ 2027-01-21, holding $327.6M (59.9%) | | Yes | Worded as "options run out", not "work ends" |
| CO size determination on latest action of active awards: 23 small / 23 other than small | | Yes | Descriptive only |
| 16 of 30 vehicles set-aside/reserved MACs | | Yes | |
| SP Systems: 71 awards, $51.8M to cutoff, separate | | Yes | Not combined |
| 35 prime-reported subawards to Halvik/SP Systems | scorecard | Yes | Labeled incomplete |
| `potential_total_value_of_award` inconsistent within award on 78 awards | Raw CSV | Yes | Methodology only |

### Public assertions

| Claim | Source | P/S | Result | Safe? |
|---|---|---|---|---|
| 17 named vehicles all held; 11 with orders by cutoff | halvik.com (10 pages undated), 2020 sheet, GSA eLibrary | P (company) / S (eLibrary) | 17/17 held, recomputed | Yes. Undated pages don't matter because the claim is verified against the record |
| NASA SITSS $148.8M potential, release C21-033 2021-11-09 | nasa.gov | P | Matched `80TECH22FA001`, ceiling $148,756,175 (−0.03%), $114.25M obligated | Yes |
| Army G-4 ~$62M, five years, 2021-08-17 | PR Newswire | P | **Unresolved.** New candidate `W52P1J21F0063` "Enterprise Services for G-4", first action 2021-01-25, $76.2M obligated; date differs by 7 months, so not confirmed | Yes, as unresolved |
| Army CCSA ~$34M | battle-updates.com reproduction | S | Unresolved | Yes, as unresolved |
| USPTO BOSS "$250M in task orders" | halvik.com undated | P | Unresolved; USPTO IDIQ orders $95.7M obligated to cutoff | Yes, as unresolved |
| WT "~$148.2M unclassified prime contract revenue TTM, 28% defense" | Washington Technology 2026-01-22 | S | Different measure; our obligations TTM $169.2M, DoD 37.2% | Yes, as context |

### Interpretation (section 8) — labeled interpretation, not measurement
- The vehicle-led growth pattern is descriptive of this one record.
- The research questions are posed as questions.
- No causality is claimed. "Past graduation" is used generically and attaches no date.

## 4. Placement decision

- `/research` already is the single Institute front door. Publications are flat, permanent slugs resolved by the registry (`src/lib/analytics/research-publications.ts` → `/research/[slug]`). The one live study is `/research/small-business-participation-benchmark`.
- A `/research/transactions/…` path would need a second route tree and a category page holding one item. That is a parallel structure, close to the "second research homepage" the brief rules out.
- **Recommendation:** `/research/halvik-tetra-tech`, with "Transaction Study 001" as the kicker.
- If Eric wants a series index later, it can be a filter on `/research`, and the slug does not move.
- Not `/gov`: that is the government-buyer marketing surface.

## 5. Before flipping to published (human review)

1. **R1:** Open the Tetra Tech press release in a browser and confirm the date 2026-01-22 and the "has acquired" wording. Cloudflare blocked a scripted fetch.
2. **R2:** Eric signs off on the headline. Recommended: **"The Federal Portfolio Behind a $210 Million Acquisition"**, with the subhead as drafted. Do not use "From 8(a) to…" unless SBA confirms the dates. If SBA confirms them, a v1.1 can add them.
3. **R3:** Read the study for wording. Figures are final.

**To publish (after R1–R3):** add one `PUBLICATIONS` entry: `RES-004`, class `research`, kind `white_paper` (or a new `case_study` kind), status `published`, slug `halvik-tetra-tech`, url `/research/halvik-tetra-tech`, publishedDate, version `v1.0`, `citesMetrics: []`. Then set `STUDY_META.version`/`publishedDate` in `halvik-tetra-tech.facts.ts`. The route branch is already wired; until the entry exists, the URL 404s (unit-tested).

## 6. What can be said today without the publish
Everything in §3 marked Safe. The distribution drafts (`tasks/halvik-transaction-study-distribution-drafts-2026-10-07.md`) use only those claims and point to the canonical URL, which does not resolve until publish.

## 7. Files
- `src/lib/analytics/transaction-studies/halvik-tetra-tech.data.json`: frozen federal figures (generated from the raw CSV; sha256 recorded inside)
- `src/lib/analytics/transaction-studies/halvik-tetra-tech.facts.ts`: non-federal facts, reconciliation, prose
- `src/lib/analytics/transaction-studies/halvik-tetra-tech-html.ts`: renderer (Mindy public-site system, single-hue charts with table views)
- `src/lib/analytics/transaction-studies/halvik-tetra-tech-html.unit.test.ts`: 10 tests (numbers, revenue/backlog/eligibility language, subsequently-reported separation, no 8(a) dates, no affiliate merge, not served until registered)
- `src/app/research/[slug]/route.ts`: renderer branch, gated by the registry
- `scripts/render-halvik-study-preview.ts`: local draft preview (noindex + draft banner)
- Draft preview: `~/Documents/halvik-transaction-study-DRAFT-2026-10-07.html`
