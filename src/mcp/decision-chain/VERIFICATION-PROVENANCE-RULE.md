# Engineering control — a live acceptance test must prove its own provenance

**Filed as its own item, not folded into 9A.**

## The rule

> **A live acceptance test is valid only if the response can be shown to originate from the
> deployed code path under test.**

Cold cache, cache-key versioning, deployment/version metadata in the response, or another
explicit provenance marker. **Without one, "live verification" can still be stale evidence.**

## What it cost, measured

Three consecutive "live verification" rounds of DEFECT-9A read stale KV entries written
before the fix. On that evidence I diagnosed and shipped **two wrong root causes**:

| # | Diagnosis | Shipped | Verdict |
|---|---|---|---|
| 1 | Count chained onto a bounded builder | PR #1311 | **Wrong** — independent `countQuery()` changed nothing |
| 2 | `?? pool.length` fallback fabricating the population | PR #1312 | **Wrong as a diagnosis** — the count worked all along |
| 3 | Result cache served a pre-fix shape for 6h | PR #1313 | **Correct** |

Both earlier changes are independently *correct* — a fabricating fallback should not exist,
and the count deserves its own query — but neither was the cause of what I was looking at.

The tell was available and I missed it: `eligible_population: 1000` **exactly equalled
`POOL_TARGET`**, and `runMarketResearch`'s own comment said *"BUMP THE VERSION whenever
ScoredEntity's SHAPE changes."* I read that comment while adding the fields.

## Why timing inference is not enough

I checked that the deploy finished **2.8 minutes after** the merge and concluded the code was
live. It was — **the code was deployed and not executing**, because a 6-hour cache entry
short-circuited it before the new path ran. Deployment freshness and code-path execution are
different facts, and only the second one matters.

## Proposed control: `code_version` in debug metadata

Add a build marker to `_meta` on tool responses (or a debug-only field) so a verifier can
assert *"this response came from commit X"* rather than inferring it:

```ts
_meta: { ..., code_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) }
```

`VERCEL_GIT_COMMIT_SHA` is already available in the deploy environment. **Caveat: a cached
response would carry the SHA of the build that WROTE it** — which is exactly the signal
wanted. A verifier compares it to the expected commit and knows immediately whether the
answer is stale.

Not implemented here; filed as an engineering control for a separate change.

## Related, already shipped

`market-research.ts` now carries a **shape guard**: a cache hit missing
`ruleOfTwoDetermination` or `sampleSize` is discarded with a warning rather than served. That
solves this specific recurrence, not the general class.

## Companion truth rules

- **unknown ≠ none** — `[]` means we looked and found none; `degraded`/`budget_limited` means
  we did not look.
- **existence vs absence** — assert existence from partial observation; assert absence only
  after exhaustive observation.
- **provenance** (this one) — a live signal must be proven to come from the code under test.
