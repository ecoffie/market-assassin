# Run 1 — VOID. Harness defect, not an architecture result.

**The frozen run was executed once, per the rules. Its result does not answer the
architecture question, because the resolver never got to make most of its decisions.**
Recording it in full rather than discarding it, and NOT counting it as the one clean run.

## What the numbers said

| Bucket (16 classifiable) | n |
|---|---|
| acceptable_top | **0** |
| acceptable_candidate_wrong_order | 0 |
| unjustified_abstention | **14** |
| miss | 2 |
| unacceptable_confident | 0 |

Ambiguous (5): 4 justified abstention, **1 unacceptable_confident** (c07 → 611430).

## Why it is void

**14 of 16 abstentions were empty-candidate-list events, not judgements.** The resolver
returned *zero* candidates and abstained by default. Two mechanical defects in MY harness:

**1. No stemming — the fatal one.**

```
entries_matching('machine shops') -> 4 entries
entries_matching('machine shop')  -> 0 entries
posting list 'shops' -> 177 entries   'shop' -> 12
```

The Census index is written in the **plural** ("Machine shops", "Automotive machine
shops"). Company prose is written in the **singular** ("is a machine shop"). With no
stemmer the two vocabularies never intersect. Loughmiller — the one unambiguous machine
shop, whose prose literally says "machine shop" — produced **zero candidates**.

**2. Phrase-order truncation.** `phrases()` emits 3-grams first, then 2-grams, then
unigrams. For Loughmiller that put `machine shop` at position **99** of 231, and
`candidates()` caps at `[:60]`. Even with stemming fixed, the decisive phrase was cut
before scoring.

Both are defects in the prototype I wrote, not properties of taxonomy-based classification.
Scoring an architecture on them would be measuring my tokenizer.

## What the run DOES legitimately show

Two real signals survive, because they came from cases that produced candidates:

- **c12 Gator Pump → 811310 "Commercial and Industrial Machinery and Equipment Repair"**
  (correct: 333914 pump manufacturing). A manufacturer classified as a repair shop.
- **w04 Komori → 811310** on the phrase `machinery equipment maintenance` (correct: 333248).

Both are the **process/service-vs-product confusion** named in advance in
SCORING-RULES-FROZEN.md. That is a genuine architectural signal and it points the same way
for a manufacturer and for a machinery maker. It is *evidence for* the concern, not proof —
two cases.

- **c07 Urban Crossroads → 611430** (training) is a real `unacceptable_confident`. The prose
  lists training among six sprawling service lanes; the resolver picked the one lane with
  crisp taxonomy vocabulary. Worth keeping regardless of the rerun.

## Decision — deliberately NOT taken here

Per the run discipline, I am **not** tweaking the resolver and re-running until it passes.
The rules forbid tuning after seeing failures; they do not require me to accept a
measurement of a broken instrument.

The distinction I am drawing, for Eric to accept or reject:

- **Fixing a stemmer so the two vocabularies can meet at all** = repairing the instrument.
- **Adjusting thresholds, weights, or the generic list after seeing which cases failed** =
  tuning to the benchmark. Not doing that.

Proposed: repair the two mechanical defects (stem plural/singular; order phrases so
specific multi-word capability phrases are not truncated), change **nothing** about
scoring, thresholds, `GENERIC_SOLO`, or the confidence rule, and take THAT as the one
clean run. Run 1 stays in the repo as void.

If Eric would rather count Run 1 as the clean run and declare Option 3 falsified, that is a
defensible call — but it would falsify a tokenizer, not the architecture.

Full per-case output: `RUN-1-void-results.json`.
