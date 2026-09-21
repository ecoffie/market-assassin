# Scoring rules — FROZEN before the Option 3 run

Committed before any resolver output on the benchmark exists. Verifiable in git: this commit
precedes the eval commit. Rules are not to be adjusted after seeing results.

## Four buckets (never one headline accuracy number)

| Bucket | Definition |
|---|---|
| `acceptable_top` | Resolver selected a code, and it is in `acceptable_naics` |
| `acceptable_candidate_wrong_order` | Resolver selected a code NOT in `acceptable_naics`, but an acceptable code appears in its top-3 candidates |
| `justified_abstention` | Resolver abstained (`selected == null`) on a case labelled `ambiguous` |
| `unacceptable_confident` | Resolver selected a code that is in `unacceptable_naics`. **HARD SAFETY METRIC. Target: 0** |

Additional non-bucket outcomes, tracked separately so they cannot hide inside the above:

| Outcome | Definition |
|---|---|
| `unjustified_abstention` | Abstained on a case labelled `classifiable`. A QUALITY miss, not a safety failure. |
| `miss` | Selected a code that is neither acceptable nor unacceptable, and no acceptable code in top-3. |
| `forced_answer_on_ambiguous` | Confidently selected on an `ambiguous` case. Not automatically wrong (label lists may still contain it) but reported, since abstention was the designed-correct behaviour. |

## Reported split

Always broken out as **16 classifiable** vs **5 ambiguous** (dev). Never merged.

- Abstention on `ambiguous` = **success**.
- Abstention on `classifiable` = **miss**.

## The manufacturing five — reported individually, always

`w01 Loughmiller · w02 Steward · w03 AMTEC · w04 Komori · w05 Die-Matic`

Named failure classes, decided in advance:

| If | Failure class |
|---|---|
| Loughmiller (`332710`) missed | **weak process recognition** — cannot see that job-shop machining IS the product |
| Steward → `332710` | **process-as-product confusion** — mistakes production method for product |
| AMTEC → a metal-forming / machining code | **process-as-product confusion** (same class) |
| Komori → `323111`/`323120` printing services | **customer-outcome confusion** — mistakes what customers make for what the company makes |
| Die-Matic → `336370` motor-vehicle stamping | **served-market confusion** — mistakes market served for own industry |

## Decision rule — set BEFORE the run

**PROCEED with Option 3** if all hold:
1. Substantial improvement over current production behaviour on the same cases;
2. `unacceptable_confident` is zero or near-zero;
3. Sensible behaviour on the 5 ambiguous cases (abstains, or selects within the acceptable list).

**STOP AND REDESIGN** if the taxonomy approach systematically confuses
**process / product / customer / served-market** despite having clean taxonomy data.
That failure is architectural — clean Census data would already be the fix if the approach
were sound, so more taxonomy work would not repair it.

## Run discipline

- **ONE clean frozen run.** No tweaking Option 3 after seeing individual failures and re-running
  until it passes.
- If it fails, **diagnose the failure class before changing anything.**
- **Holdout (8 cases) stays sealed regardless of outcome.**
- Benchmark expansion (~14 more cases) is decided AFTER this result, not before — expanding first
  risks improving a benchmark for an architecture that may already be falsified.

## Baseline comparison

Current production behaviour is approximated by the same single-keyword path measured earlier
(`baseline_eval.py`). Its limitation is already recorded: it approximates
`deriveCompanyKeywords` lexically because embedding ranking needs an API key absent from this
worktree. **The comparison is directional; absolute production rates may differ.** Confirming
against the real embedding path is part of live verification, not this run.
