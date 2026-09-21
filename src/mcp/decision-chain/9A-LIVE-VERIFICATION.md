# 9A live verification — 2 of 3 states observed. Case 2 not found in the wild.

Run against production on a **cold cache** (v3 + shape guard), so this is the first
observation of the real code path. All prior runs read stale v2 entries and are void.

## Case 1 — sampled, ≥2 capable → `met`, conclusive ✅

`assess_market_depth(561720, "Small Business")`

```
eligible_population:       20074      ← was 1,000 (fabricated)
sample_size:               231
sample_coverage:           0.0115      ← 1.2%, was 23.1%
capable_in_sample:         132
rule_of_two_determination: met
rule_of_two_conclusive:    true
rule_of_two_met (deprec):  true        ← old clients still work
```

> *"SAMPLED, NOT EXHAUSTIVE: 231 of 20,074 eligible firms were evaluated (1.2%). Rule of Two
> is MET — finding at least two capable firms proves they exist, so this conclusion holds
> regardless of coverage."*

**The count was working the entire time.** Both earlier diagnoses were wrong; the stale cache
was the only defect. `eligible_population` is now the true population and coverage reports
1.2% instead of the flattering 23.1%.

## Case 3 — exhaustive, <2 capable → `not_met`, conclusive ✅

`assess_market_depth(519190, "Small Business")` — 3 eligible firms

```
eligible_population:       3
sample_size:               3
sample_coverage:           1          ← exhaustive
capable_in_sample:         0
rule_of_two_determination: not_met
rule_of_two_conclusive:    true
counts.registered_only:    3
```

> *"EXHAUSTIVE: all 3 eligible firms were evaluated. Fewer than two met the capability
> threshold on the available evidence. This is market-research evidence, not a contracting
> officer's legal determination."*

The one case where a definitive negative IS warranted, and it says so — with the legal
framing intact.

## Case 2 — sampled, <2 capable → `undetermined`: NOT OBSERVED ⚠️

**Searched, not found.** Attempts:

| Market | Eligible | Result |
|---|---|---|
| 722515 | 1,032 | 77 capable → `met` |
| 623311, 423920, 611410, 445298, 487990, 486110 | 258–810 | all **< 1,000**, so exhaustive → would give `not_met` |
| ~29 single-performer NAICS | all < 1,000 | same |

**Why it is hard to find — the same structural tension as the earlier false-negative hunt.**
The case requires a market simultaneously:
1. **thick enough** that eligible > 1,000 (pool binds), and
2. **thin enough in capable firms** that <2 land inside the sample.

At >1,000 eligible, enough firms carry *some* award history that ≥2 clear the capable
threshold by volume alone. Markets with almost no performers are almost always small enough
to evaluate exhaustively.

**The logic is proven at unit level** (`defect-9a-measurement.seam.test.ts`, 8 cases, incl.
"a sampled result NEVER reports not_met"), and the two branches that DO occur in production
are verified live. What is unverified is the live wiring of the third branch specifically.

## Assessment

| State | Verified |
|---|---|
| `met` (sampled, conclusive) | **live** ✅ |
| `not_met` (exhaustive, conclusive) | **live** ✅ |
| `undetermined` (sampled, <2) | unit only ⚠️ |
| deprecated `rule_of_two_met` compatibility | **live** ✅ |
| `eligible_population` exhaustive & correct | **live** ✅ |

**Recommendation: close 9A on cases 1 and 3**, recording case 2 as unobserved-in-the-wild
rather than unverified-in-logic. Its absence is itself informative — it is the rarest
production state, which is consistent with the earlier finding that a sampling-induced false
negative is structurally hard to produce.

**Eric's call**, not mine. The alternative is to keep hunting, and the earlier timeboxed hunt
suggests that could run long without succeeding.

## What this verification cost, and the lesson

Three "live" verification rounds were run against stale cache entries before the v3 bump.
Two root causes were diagnosed and shipped against evidence that never came from the code
under test.

> **A stale cache is indistinguishable from working code.**
> "Verify against a live signal" is necessary but NOT sufficient — the live signal must be
> proven to come from the code under test.

The shape guard now enforces that: a cache entry missing a current-shape field is discarded
rather than served.

---

# DEFECT-9A — CLOSED 2026-08-24

Closed on live production evidence, per the PRD rule that a defect closes on a confirmed
live signal and never on a green suite.

| Case | State | Evidence |
|---|---|---|
| **1** | sampled, ≥2 capable → `met` | **OBSERVED LIVE.** 561720: `eligible_population` 20,074 (exhaustive denominator), `sample_coverage` 1.2%, `determination: met`, `conclusive: true` |
| **3** | exhaustive, <2 capable → `not_met` | **OBSERVED LIVE.** 519190: 3 of 3 evaluated, `coverage: 1`, `determination: not_met`, `conclusive: true`, legal caveat intact |
| **2** | sampled, <2 capable → `undetermined` | **NOT OBSERVED LIVE.** Covered by unit tests; not found in a timeboxed production search |

**Case 2 is recorded as "branch not naturally observed", NOT as "logic unverified."** The
distinction matters: `defect-9a-measurement.seam.test.ts` pins the behaviour including *"a
sampled result NEVER reports not_met"*, and the failure to find a live instance is consistent
with the market-structure effect measured earlier — the branch requires a market both thick
enough for the pool to bind and thin enough in capable firms for <2 to land inside, and those
conditions pull against each other.

## What 9A fixed

`market_depth` and `capable_depth` were computed from an unordered, bounded 1,000-row slice
of populations up to 56,744 — and named and rendered as properties of the *market*. In 377 of
971 NAICS (38.8%) the eligible population exceeds that pool.

Now: `eligible_population` is an exhaustive SQL count, the sampled figures are named as
samples, coverage is published, and the Rule-of-Two determination is one-sided —
**existence provable from a sample, absence only from exhaustion.**

Two UI surfaces that rendered the ambiguous boolean as a verdict were fixed in the same
change; `/gov/market-research` had been advising users to *"broaden the place of performance
or the set-aside"* on a conclusion the data could not support.

## Still open, deliberately

**DEFECT-9B (P1)** — unordered arrival is still the retrieval strategy for the *supplier
list*. 9A removed the measurement claim; the ranked list is still not top-N by merit in the
377 markets where the pool binds.

## Ledger

| Item | Status |
|---|---|
| P0-1 | Closed — development stopped, holdout sealed, safety gate shipped |
| P0-2 | **CLOSED** — production verified |
| P0-3 | **CLOSED** — production verified |
| **DEFECT-9A** | **CLOSED** — production verified (cases 1 & 3) |
| DEFECT-9B | Open, P1 |
| DEFECT-7 (`lookup_sam_entity` degraded) | **FIXED + MERGED** (#1319/#1320) — SAM-key rotation remains ops work |
| DEFECT-8 (capability vs interest) | Filed |
| SAM field audit (140 of 157 dropped) | Filed |
| Verification provenance control | Filed |
| Testing debt (source-text guards) | Filed |
