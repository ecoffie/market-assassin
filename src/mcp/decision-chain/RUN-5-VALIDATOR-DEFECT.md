# Run 5 — VOID. My validator is the defect, not the extractions.

Both arms ran under an identical contract. Both collapsed. **The cause is my validator, and
it is the exact mistake Eric warned against.**

## Result as measured (do not use)

| | cheap | strong |
|---|---|---|
| validation passed | **2/21** | **6/21** |
| acceptable_top (of 16) | 0 | 2 |
| unjustified_abstention | 14 | 12 |
| unacceptable_confident | **0** | **0** |
| justified_abstention (of 5) | **5/5** | 4/5 |

## Why it is void

Eric's instruction: *"I'd avoid defining 'compound' as simply contains `and`. That's another
lexical heuristic waiting to betray you."*

I then wrote `re.split(r'\s+and\s+|;|\s+/\s+', value)` inside `validate_extraction.py` and
called it structural. It is not structural. It is the lexical heuristic, relocated.

Confirmed false rejections — all three are **single** offerings:

| Case | Rejected value | Reality |
|---|---|---|
| w04 | `"offset and digital printing presses"` | ONE product line, two variants of a press |
| w03 | `"40mm Grenade Ammunition and Fuzing"` | ammunition with its fuzes — one product family |
| c12 | `"high-volume centrifugal pumping equipment"` | "and" appears only inside a compound noun elsewhere in the phrase |

`primary_conflates_offering_and_process` is also over-firing on substring containment:
w04 rejected because the token `"offset"` appears in the process `"offset press
manufacturing"` — but a press manufacturer whose process is press manufacturing is
*correct*, not conflated.

So the 19 and 15 rejections do not measure extraction quality. They measure my splitter.

## What the run still legitimately shows

Two signals survive because they do not depend on the broken rule:

1. **`unacceptable_confident` = 0 in BOTH arms** (Run 4: 1; Run 2: 3). Nothing confidently
   wrong was emitted. Some of that is the gate refusing everything, so it is weak evidence —
   but the two-dimensional confidence gate did fire correctly where tested.
2. **Justified abstention restored: 5/5 cheap, 4/5 strong** (Run 4: 0/5). Douglasway no
   longer returns General Medical Hospitals. **The extraction-confidence gate fixed the
   abstention regression**, which was its purpose, and it did so without touching
   `MIN_SCORE`/`MIN_MARGIN`.

That second finding is real and independent of the validator defect.

## Cheap vs strong — partial, not conclusive

Strong passed 6/21 vs cheap 2/21 and produced tighter cores (`"high-volume centrifugal
pumping equipment"` vs `"centrifugal pumping equipment and related components"`; three
processes vs seven). Directionally the stronger model writes cleaner extractions. But with a
broken validator gating both, **this is not the controlled comparison Eric asked for** and
must not be reported as one.

## The fix, and the line I am drawing

The validator must test what Eric specified — *"if `primary_offering` contains multiple
independently sellable things"* — and the only reliable judge of "independently sellable" is
the model that wrote it, not a regex over conjunctions. Correct implementation: have the
extractor emit `offerings[]` as a typed LIST with one flagged `is_primary`, so multiplicity
is expressed in the STRUCTURE and never has to be parsed out of prose.

That is a schema change, not a threshold change, and it is motivated by a defect in my
instrument rather than by which cases failed — the same distinction accepted for the Run-1
stemmer repair.

**Not doing:** relaxing the validator until cases pass. **Not doing:** re-running until the
number improves.

Holdout sealed. Five runs, untouched.

Per-arm output: `/tmp/run5_cheap.json`, `/tmp/run5_strong.json` (copied alongside).
