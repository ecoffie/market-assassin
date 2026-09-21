# 9A follow-up — the count still returns 1,000, and my first diagnosis was wrong.

## Two live runs, same wrong number

| Run | Deploy | `eligible_population` | True value |
|---|---|---|---|
| 1 | before the fix | 1,000 | 20,074 |
| 2 | **after** `countQuery()` shipped | **1,000** | 20,074 |

`countQuery` is confirmed present on `origin/main` and deployed. **So the "chained builder"
diagnosis was wrong** — an independent count query did not change the result.

## The real mechanism

`market-research.ts:551` (before this change):

```ts
const eligiblePopulation = eligibleCount ?? pool.length;
```

**`pool.length` is exactly `POOL_TARGET` = 1,000.** When the count returns null, the fallback
silently substitutes the pool size — producing a number that is indistinguishable from a real
measurement, and that happens to equal the bound the field exists to expose.

That is an unknown-vs-none defect **inside the fix for an unknown-vs-none defect**. The `??`
made a failed count look like a successful one.

The count was almost certainly failing all along; run 1 and run 2 are the same symptom, and
the `countQuery` change was a no-op against a null-returning path.

## What changed now

- `eligiblePopulation` is `number | null` — **no fallback to `pool.length`, ever**.
- `sampleCoverage` is `number | null`; unknown population ⇒ unknown coverage ⇒ **never
  `exhaustive`**, so an unmeasured denominator cannot license a definitive negative.
- The count error is logged instead of swallowed.
- New caveat for the null case: *"COVERAGE UNKNOWN … treat any shortfall below two capable
  firms as UNDETERMINED, not as a negative finding."*
- MCP layer emits `null`, not `0` — `0` would read as "no eligible firms".

The typechecker forced every consumer to handle null, which is the point.

## STILL UNKNOWN — why the count fails

**Not diagnosed.** The SQL itself is sound: run directly against Supabase, the identical
filter returns 20,074. Leading hypothesis is that PostgREST `count: 'exact'` times out or
errors on a 910,123-row table behind two GIN containment filters — the registry expansion
made the table 85% larger, and this count is new code that has never run against the smaller
table.

**The error is now logged, so the next deploy will say.** I am not guessing further before
reading it.

## Honest status

**9A remains OPEN.** Case 1 passes on the part that matters most — `determination: met`,
`conclusive: true`, correct caveat — because `met` is coverage-independent by design. But
`eligible_population` and `sample_coverage` are still wrong, and those are the fields 9A
exists to add. Cases 2 and 3 are not yet run.

**What this change guarantees even without the root cause:** the tool can no longer report a
fabricated population. It reports `null` and says coverage is unknown, which is the correct
answer when the count did not run.
