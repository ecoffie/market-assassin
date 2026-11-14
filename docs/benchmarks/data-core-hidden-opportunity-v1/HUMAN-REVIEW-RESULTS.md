# Human review results (2026-11-14)

One human reviewer (the project owner) judged all 47 items on the review page (G01–G06, R01–R11, S01–S30).
They are recorded in `labels.jsonl` under `human_label`, `human_decision`, `human_notes` and `human_review_id`; the source is the
page's `reviews` collection. Items nobody reviewed stay `AI_UNVERIFIED`. Reproduce with `python3 -I scripts/score.py --labels human`
(human labels only) or `--labels merged` (human where reviewed, otherwise the AI label).

## Where the human and the AI labels agree and disagree

| Set | Items | Human kept the AI's relevant/not call | Human changed FIT↔PARTIAL only | Human flipped relevant/not |
|---|---|---|---|---|
| S01–S30 (random) | 30 | 30 | 3 (PARTIAL→FIT) | **0** |
| R01–R11 (recovered) | 11 | 11 | 4 (PARTIAL→FIT) | **0** |
| G01–G06 (gate "false positives") | 6 | 1 | — | **5 (NO→relevant)** |

- **Random sample:** the AI's relevant/not call matched the human on 30 of 30 items (95% interval 89–100%). Every change was the AI under-rating a fit.
- **G items:** these were the evidence gate's "false positives" under AI labels. Six of the seven had their quoted sentence outside the excerpt the AI
  reviewers saw. The human judged 5 of 6 relevant, including three where both AI reviewers had said NO. Notes on two of them:
  "your scope is within the SOW as a subcontractor not as a prime contractor." **The gate was right and the excerpt-limited labels were wrong.**
- So the AI labels are reliable when the deciding text is visible to the reviewer, and they undercount subcontract scope when it is not.
  Any future AI labelling must show the reviewer the gate sentence.

## The v1 evidence gate, rescored

| Profile-phrase gate, lane top-100 | Shown | Relevant | Precision | 95% interval |
|---|---|---|---|---|
| AI labels only (as published) | 20 | 13 | 65% | 43–82% |
| Human-reviewed items only | 11 | 10 | 91% | 62–98% |
| Merged (human where reviewed, AI elsewhere) | 20 | 18 | 90% | 70–97% |

The other gates still fail with merged labels: vocab 24/65 (37%), either 27/69 (39%), no gate 28/100 (28%).

## What this does and does not establish

- **Does:** on the Nov 14 snapshot, a notice sentence that contains the customer's own trade phrase and a requirement cue is a trustworthy basis.
  With merged labels, 18 of 20 such rows were relevant, and humans confirmed 10 of the 11 they checked. This supports the design both agents agreed
  on: a plan-retrieved row that sits in "other" carries its quoted SOW sentence as the basis, with a sub/prime role.
- **Does not:** clear the production bar. One reviewer, who is not independent of the product. Eleven human-checked gate rows, chosen
  non-randomly (the recovered and G items were picked *because* of their AI label). In-sample on the snapshot the gate was designed on. Profile-length
  descriptions, not the short phrasings where the v2 lane failed (11–14%). The 60% bar still needs a blind, human-labelled holdout of notices posted after Nov 14.
- **Unchanged:** released FIND already retrieves the five steel examples, so the jobs are buried, not hidden. The fix is meaning-order within FIND's
  groups (Agent 3 owns it, after PR #2050), not a separate lane. The v2 lane results are unaffected; its upper bound is already below 60%.
