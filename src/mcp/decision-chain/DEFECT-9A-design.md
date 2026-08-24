# DEFECT-9A design — classify each metric by the evidence it requires. No code yet.

Eric: *"don't force a COUNT solution just because it sounds exhaustive. First classify each
metric by what evidence it actually requires."*

Done. The answer splits cleanly, and it is **not** "COUNT everything".

## What the score actually needs

`scoreEntity()` (market-research.ts:117-165) computes 0-100 from five components:

| Component | Points | Evidence source |
|---|---|---|
| Recent activity (months since last award) | 30 | **BigQuery award history** |
| Set-aside eligibility | 25 | `sam_entities.certifications` — **SQL** |
| NAICS relevance (`wonTargetNaics`) | 20 | **BigQuery** (10/5 fallback is SQL) |
| Track record ($ volume, award count) | 15 | **BigQuery** |
| Agency breadth (distinct agencies) | 10 | **BigQuery** |

Tiers: `>=70 active_performer`, `>=45 capable`, `>=25 emerging`, else `registered_only`.

**75 of 100 points require per-UEI BigQuery activity.** So:

## Metric classification

| Metric | Definition | Exhaustively computable in SQL? | Verdict |
|---|---|---|---|
| **eligible population** | active + not excluded + NAICS + size/cert filter | **YES** — pure `sam_entities` | **Compute exhaustively** |
| `registered_only` | score < 25 — in practice, no award activity | **YES** (as "eligible minus those with activity") | Derivable |
| **`capable_depth`** | active_performer + capable, i.e. **score ≥ 45** | **NO** — needs BQ activity per firm | **Cannot be a COUNT** |
| **`market_depth`** | active + capable + emerging, i.e. **score ≥ 25** | **NO** — same reason | **Cannot be a COUNT** |

A firm reaches 25 points on SQL-only evidence *only* via cert (25) — so a scored-25 threshold
is not reconstructable without activity. **Eric was right to warn against forcing COUNT.**

## Therefore: honest naming, not a fake exhaustive number

The fix is **not** to make `capable_depth` exhaustive by brute force — scoring 20,074 firms
means a BigQuery activity fetch over 20,074 UEIs per research run, which reopens the cost
incident the caching comments in this very file document.

The fix is that **a sampled estimate must not be presented as a population measurement.**

### Proposed output shape

```
eligible_population: 20074        // EXHAUSTIVE — SQL COUNT over the full filter
sample: {
  examined: 1000,                 // how many were actually scored
  coverage_pct: 5.0,
  basis: "bounded candidate pool"
}
capable_depth_in_sample: 132      // renamed — it is what it is
market_depth_in_sample: 196
rule_of_two_met: true             // ≥2 capable found; see asymmetry below
rule_of_two_basis: "sample"       // or "exhaustive" when coverage is 100%
```

### The asymmetry that makes this safe

Rule of Two asks **"are there at least 2?"** — a one-sided question:

- **Finding ≥2 in a sample is conclusive.** They exist. `rule_of_two_met: true` is sound
  regardless of coverage. 561720's `true` is CORRECT today.
- **Finding <2 in a sample is NOT conclusive** when coverage < 100%. That is the false-negative
  risk, and it is the case that must never be reported as a definitive negative.

So: `rule_of_two_met: false` **must** carry `conclusive: false` whenever `coverage_pct < 100`,
with text saying the market was sampled and ≥2 capable firms may exist outside the sample.

**This is the actual bug fix** — not the pool size. A confident false negative becomes an
explicit "not determined", which is exactly the unknown-vs-none rule from P0-2 applied to a
decision metric.

### Escalation for small markets

When `eligible_population <= POOL_TARGET`, coverage is 100% and every metric is exhaustive —
`rule_of_two_basis: "exhaustive"`, `conclusive: true`. **That covers 594 of 971 markets (61%)
outright.**

For the 377 markets where the pool binds and the sample finds <2 capable, the honest options
are (a) report inconclusive, or (b) escalate: widen the pool until ≥2 capable are found or the
population is exhausted. (b) is bounded work precisely because it stops at 2.

## Acceptance for 9A (Eric's invariant)

> **Changing the retrieval pool size or DB row ordering must not change the market-depth
> result.**

Satisfiable as stated only for `eligible_population`, which is exhaustive by construction.
For the sampled metrics the invariant becomes:

- `eligible_population` — **invariant** under pool size and ordering. Testable directly.
- `capable_depth_in_sample` — **varies by construction**, and is now *named* so it may.
- `rule_of_two_met: true` — **invariant**: once ≥2 are found, more sampling cannot unfind them.
- `rule_of_two_met: false` — carries `conclusive: false` unless coverage is 100%.

Test markets: **561720** (20,074 eligible, 5% coverage) and **541611** (56,744 eligible, 1.8%).

## 9B (P1, separate)

Unordered arrival is not a defensible retrieval strategy for the supplier list. Deferred —
9A removes the *measurement* claim, which is the part that misrepresents itself.
