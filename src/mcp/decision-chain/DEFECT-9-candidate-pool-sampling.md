# DEFECT-9 (P1) — candidate-pool sampling drops eligible high-merit firms before scoring

Filed separately from P0-3, which is CLOSED. The invariant broken here:

> **An eligible high-merit firm must have a fair opportunity to enter the ranked candidate set.**

**Traced, not hypothesised.** The mechanism is confirmed and the exact loss point is located.

## The trace: 20,074 eligible → 1,000 pool → 231 returned

`src/lib/gov-buyer/market-research.ts`:

```ts
const POOL_TARGET = Math.max(limit * 10, 1000);
for (let from = 0; from < POOL_TARGET; from += 1000) {
  const { data } = await buildQuery().range(from, Math.min(from + 999, POOL_TARGET - 1));
  ...
}
```

**`buildQuery()` has no `.order()`.** Rows are paged by `range()` over an unordered result, so
which 1,000 of 20,074 arrive is decided by physical/plan order — not merit, and not stably.

Positions of the two known Y performers in the eligible set:

| Firm | Arrival position | In first 1,000? |
|---|---|---|
| NMI ALASKA, INC. | **6,822** | No |
| OS-DB-JV-2 LLC | **12,067** | No |
| *(total eligible)* | *20,074* | |

Confirmed directly: a `LIMIT 1000` over the same filter returns **0 of 2**. They are lost at
the pool hop, **before scoring runs**. The hypothesis is proven; they do not lose on merit.

## Why it appeared now

The bound is old; it only started binding when the population stopped being empty:

| | eligible rows | pool | coverage |
|---|---|---|---|
| Before P0-3 | **0** | 1,000 | n/a — nothing to sample |
| After P0-3 + registry expansion | **20,074** | 1,000 | **5.0%** |

The registry expansion (491,323 → 910,123 entities) and the P0-3 filter fix together turned a
latent scaling assumption into an active defect. The file's own comment warns about exactly
this failure mode — *"rather than letting an arbitrary DB page decide before scoring ever
runs"* — while the code still lets the DB page decide.

## Severity: P1, with a stated promotion trigger

**P1, not P0.** The legal/market conclusion is correct: `market_depth: 196`,
`capable_depth: 132`, `rule_of_two_met: true` for a market that genuinely has depth. What is
unreliable is the **composition of the returned supplier list** — it is not top-N by merit,
and a user reading it as "the best available small businesses" would be misled.

**Promote to P0 if** tracing shows the bounded pool can materially change `marketDepth`,
`capableDepth`, or flip the Rule-of-Two conclusion in a thinner market. That is the untested
risk: with 20,074 eligible and 5% sampled, depth 196 is a floor, not a measurement. In a
market with ~15 eligible firms clustered past the cutoff, the same mechanism could produce a
false NEGATIVE Rule-of-Two — the P0-3 failure mode returning by a different route.

**Not tested yet.** That test is the next step and should decide the severity.

## Reconciled while here: 196 vs 231

Not a defect. The arithmetic is exact:

| | |
|---|---|
| active_performer 0 + capable 132 | = **capable_depth 132** |
| + emerging 64 | = **market_depth 196** |
| + registered_only 35 | = **businesses returned 231** |

`registered_only` firms are deliberately excluded from depth (they have no relevant award
history) but still listed, which is the documented FM-03 behaviour and is stated in the
caveats. **A user seeing "196 depth" beside a 231-row list will still ask why** — worth a
one-line explainer in the tool output, since the reconciliation is not self-evident.

## Not fixed here

No change to sampling, ordering, or scoring. Adding an `.order()` would make the pool
deterministic but would still sample 5% by whatever key is chosen — the real question is
whether the pool should be bounded at all for depth counting, or whether depth should be a
`COUNT(*)` independent of the scored sample. **That is a design decision, not a patch.**

---

# PROMOTION TEST — measured 2026-08-24. Recommend P0.

Eric's trigger: *"promote to P0 if the bounded pool can materially change marketDepth,
capableDepth, or flip Rule-of-Two in a thinner market."*

## Blast radius

| | |
|---|---|
| 6-digit NAICS with small-business populations | 971 |
| **NAICS where eligible firms EXCEED the 1,000 pool** | **377 (38.8%)** |
| Firm-market pairs in those oversized markets | 1,658,965 |
| Largest single market (541611) | 56,744 eligible |

**Two of every five markets Mindy can be asked about are sampled, not measured.** In 541611
the pool sees 1.8% of the eligible population.

## The decisive measurement

Of the known 561720 small-business performers:

| | |
|---|---|
| Reachable within the first 1,000 rows | **0** |
| Unreachable (beyond the cutoff) | **2** |

**Zero of the market's known small-business performers are reachable by the pool.** 561720
survived only because 132 *other* capable firms happened to land inside the window — depth
was carried by the sample's bulk, not by the firms we independently verified matter.

That is the exact failure shape for a thin market: if a market's capable firms sit past
position 1,000 and fewer than two others fall inside, `capable_depth` drops below 2 and
`rule_of_two_met` returns **false** for a market that genuinely has depth.

**That is the P0-3 defect returning by a different route** — same wrong answer ("no small
businesses, do not set aside"), different cause (arbitrary DB page instead of the wrong
column).

## Why I stop short of "confirmed false negative"

I have **not** produced a live market where `rule_of_two_met` is demonstrably false but should
be true. What is measured:

- the mechanism (no `.order()`, `.range()` paging) — **proven**;
- specific eligible high-merit firms dropped before scoring — **proven** (positions 6,822 and 12,067);
- 38.8% of markets exceed the pool — **proven**;
- zero known performers reachable in the flagship market — **proven**;
- a live Rule-of-Two flip — **not demonstrated**.

Finding one requires scanning candidate NAICS for a market whose capable firms cluster beyond
the cutoff. Feasible, and the honest next step before any fix.

## Recommendation

**Promote to P0.** The trigger condition is met in substance: the bounded pool demonstrably
governs which firms reach scoring in 38.8% of markets, and in the one market we verified in
depth it excluded 100% of the known performers. Waiting for a customer to hit a false negative
on a set-aside determination is the wrong way to confirm it.

Severity note: unlike P0-3, this defect **cannot be seen from the output**. A false
`rule_of_two_met: false` looks identical to a true one — same shape, `grounded: true`, no
degraded flag. Same invisibility that let P0-3 persist.
