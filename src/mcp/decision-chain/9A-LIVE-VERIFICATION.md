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
