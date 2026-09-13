# When a user says a filter is broken

**The rule (Eric, 2026-09-12 — earned the hard way):**

> **Test the exact saved filter contract, and compare total truth vs mappable truth,
> BEFORE touching filter code.**

Two halves. Both were violated during the investigation that produced this rule, and
each half cost real time.

---

## Half 1 — compare *total truth* vs *mappable truth* first

The reported symptom was "the Opportunity Map filters don't work." Seven filter defects
were found and four were real and severe. **None of them was the cause.**

The cause was that only **513 of 11,012 open opportunities (4.7%) had coordinates.** Every
filter was CORRECT — NAICS, agency, set-aside, state all returned genuinely matching rows
with zero contamination — and the map still showed a user with 42 real matches the number
"1". Nothing errored. The headline simply answered a narrower question ("rows we can plot")
in the words of a broader one ("opportunities matching your filters").

So the FIRST diagnostic is not a filter test. It is two counts:

```sql
-- total truth: how many rows genuinely match?
SELECT count(*) FROM <table> WHERE <the user's filters>;
-- mappable truth: how many can the surface actually show?
SELECT count(*) FROM <table> WHERE <the user's filters> AND map_lat IS NOT NULL;
```

If those two numbers differ materially, **stop**. The filter is probably fine and the
data completeness is the bug. Chasing filter logic first means fixing seven things that
were never going to help the person who complained.

Generalize past `map_lat`: any surface with a completeness predicate has this shape — a
geocode, a join that drops unmatched rows, an enrichment column, an embedding. The
question is always *"what does this view silently require that the filter does not?"*

## Half 2 — use the EXACT saved filter, never an approximation

The four acceptance fixtures were first computed as:

| saved search | reported "truth" | ACTUAL truth |
|---|---|---|
| NJ Construction | 31 | **1** |
| TX 541-series | 24 | **6** |
| janitorial 561720 | 42 | **3** |

Those "truth" numbers were wrong. They were derived from a simplified reading of each
saved search that **dropped the `fullOpen` flag and used NAICS prefixes where the user
had saved exact 6-digit codes**. Only 3 of 42 janitorial opportunities are Full & Open —
the map returning 3 was exactly right, and the approximation made a healthy surface look
99% broken *in the incident report itself*.

The saved filter is a CONTRACT. Read it from the row (`saved_searches.filters`) and apply
it verbatim. An approximation of a filter is a different filter, and comparing against it
produces confident, wrong conclusions — the same failure class the product bug was.

---

## The order that works

1. **Get the user's real filter** — from `saved_searches.filters`, not a paraphrase.
2. **Count total truth vs surface-visible truth** with that exact filter.
3. If they differ → it is a **data completeness** problem. Fix the pipeline.
4. If they match → now test filter semantics (fail-open, OR/AND, multi-value, normalization).
5. Either way, state which of the two you proved, and never report a count without saying
   which question it answers.

## What it cost, for calibration

- 7 filter defects found, 4 real (multi-state failing OPEN to the entire corpus was
  genuinely severe and shipped as its own fix, PR #1435).
- But the customer-visible problem was 100% data completeness: after geocoding,
  coverage went 4.66% → 95.66% and `naics=541611` went **0 → 22** results.
- The permanent guard that came out of it: **market truth != mappable count**
  (`src/lib/opportunities/map-truth-disclosure.ts`), plus a recurring geocode job that
  FAILS when coverage decays instead of reporting a cheerful 200.

## Related

- `docs/engineering/a-number-is-a-product-feature.md` — this incident is an instance of it.
- `docs/engineering/silent-failure-registry.md` — "no source != zero"; an unestablished
  filter must narrow to nothing, never widen to everything.
- `src/lib/opportunities/map-truth-disclosure.ts` — the disclosure contract + its gate.
