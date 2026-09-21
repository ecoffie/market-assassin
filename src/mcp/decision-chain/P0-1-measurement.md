# P0-1 — three resolvers measured on the frozen dev set. None clears the bar.

**No resolver change written. Invoking the stated stopping rule.**

> "If discriminative scoring can't beat the current resolver convincingly on that set
> without damaging genuine 332993/333244 cases, that's our signal to stop tuning the
> scoring function and move upstream to Option 3: change the data boundary."

## Results (8 dev cases, real FY2025 award prose, identical inputs)

| Resolver | First choice | Acceptable in top-3 | Wrong code dominates | Abstains |
|---|---|---|---|---|
| **Current** (single keyword → `allNaics[0]`) | **1/8** | 1/8 | several | never |
| **Lift** (share ÷ baseline, aggregated) | **2/8** | 2/8 | **0** | 3/8 |
| **Title match** (Option 3 probe, partial vocab) | **3/8** | 3/8 | 0 | n/a |

**2/8 vs 1/8 is not convincing.** It is one case on a set of eight.

## What the current resolver actually does

Worse than the single machine-shop report suggested. The leads it selects on real
contractor prose: `gate`, `price`, `access`, `examining`, `the fabrication`. Generic
tokens across the board. **7 of 8 real descriptions resolve to an unacceptable NAICS** —
this is not one bad keyword, it is the architecture.

## Why lift did not win

Two properties were genuinely good:
- **Zero cases where a wrong code dominates** (the current resolver has several).
- **Abstention fired** on the three most ambiguous cases instead of confidently
  declaring nonsense.

But it fails the load-bearing constraint:

- **It abstained on the genuine ammunition maker** (`dev-ammo-40mm`). 332993 MUST remain
  selectable. Abstaining on a real ammunition manufacturer is the regression the hard
  negatives exist to catch.
- **Lift over a $708B baseline over-rewards tiny obscure codes.** Top-3 for ammunition was
  `333998, 321920 (wood containers), 339113`; IT surfaced `624230 emergency relief`;
  electrical surfaced `811310`. The "milling → 311212 Rice Milling" false positive I
  flagged earlier generalises: any code with a near-zero baseline gets an enormous
  multiplier from a single mention.

A denominator floor, a minimum-dollar gate, and a corroboration count were all tried in
the scoring pass. They trade one failure for another. **This is the point where more
tuning would be overfitting to 8 cases**, which is exactly what the dev/holdout split was
built to prevent. Holdout remains unread.

## Why Option 3 is the recommendation

Title matching scored 3/8 on a **partial** vocabulary — only 286 codes, harvested
incidentally from fixtures, versus ~1,000 real NAICS. It is the only approach that is
*structurally* immune to the contamination, because it never touches award-description
text: DoD ammunition contracts can describe machining all they like and it cannot move
the result.

It is not yet a validated win. It matched on weak tokens (`equipment`, `pallet`, `units`)
and missed the regression fixture entirely. What it demonstrates is that the *upstream*
change has more headroom than the scoring function does, on a fraction of the data.

## Recommended next step (not taken — needs your call)

Build the real Option 3 path: full NAICS/PSC title + index-entry vocabulary (the official
Census NAICS index has ~20k entry terms, e.g. "machine shop, job or repair" → 332710),
matched against capability phrases, with award-spend used only to *rank among plausible
codes* — never to select them.

That inverts today's data flow: **titles decide WHICH markets are candidates; dollars only
order them.** Contamination cannot enter selection.

## Cost note

Baseline and lift evaluation each issue one USASpending call per candidate phrase per case
(~10 phrases × 8 cases). Cached per keyword within a run. A CI-resident version must use
frozen fixtures, not live calls.

## Files

- `baseline_eval.py` — current-resolver approximation, dev set
- `lift_eval.py` — lift resolver, same inputs
- `fixtures/classification-set.json` — 8 dev + 4 frozen holdout
- `fixtures/naics-BASELINE.json` — FY2025 unfiltered universe, $708.9B / 99 codes

**Caveat on both scripts:** they approximate `deriveCompanyKeywords` with a lexical
extractor. The real one ranks candidates by embedding similarity, which needs an API key
absent from this worktree. The *relative* comparison is sound (identical inputs to all
three), but absolute pass rates for the current resolver may differ in production.
Confirming that is part of the live verification step, not a reason to delay the decision.
