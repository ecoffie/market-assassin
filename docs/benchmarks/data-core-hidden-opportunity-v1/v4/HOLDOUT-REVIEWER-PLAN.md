# Human holdout: reviewer plan (for Eric's approval)

Holdout protocol: `RELEASE-GATE-AND-HOLDOUT.md` §2 (approved for preparation). Gates preserved: pooled top-20 ≥ 60%, **no business below 40%**,
recall within codes ≥ 50%. Retrieval, evidence classification and ranking are measured and reported separately.
**No money is spent on reviewers until you approve it.**

## 1. Workload

| Item set | Snapshot 1 (2026-12-12, 12 businesses) | Snapshot 2 (2027-01-09, guards + nursing) |
|---|---|---|
| Top 20 of production and the candidate, de-duplicated (≈ 25 per business) | ≈ 300 | ≈ 50 |
| Code-floor census or random 30 per business | ≈ 330 | ≈ 25 (low volume) |
| Replacement-parts recall pool (new; parts has no code floor) | 30 | — |
| AI-disputed rows from the matched-set and removed-row samples | ≈ 30 | ≈ 5 |
| **Primary reviewer total** | **≈ 690** | **≈ 80** |
| Second reviewer, a random 15% overlap | ≈ 105 | ≈ 15 |

Time per item is 30–60 seconds. Product notices with an NSN and a short title are fast; services with a scope of work to read are slow.

| Role | Items | Hours (low–high) |
|---|---|---|
| Calibration (both reviewers, 20 pre-freeze items from the v1 human set, never scored) | 20 each | 0.5–1 each |
| Primary reviewer | ≈ 770 | **6.5–13** |
| Second reviewer (15% overlap) | ≈ 120 | 1–2 |
| Agent 4 preparation and scoring (offline) | — | no reviewer cost |
| **Total human time** | | **≈ 9–17 hours** |

## 2. Reviewer options and cost

| Option | Who | Incremental cost | Independence | Risk |
|---|---|---|---|---|
| **A (recommended if spend is approved)** | Primary: an external GovCon BD or proposal specialist, paid by the hour. Second: an internal staff member not involved in search | ≈ $500–$1,300 at $50–$100/h for 6.5–13 h (estimate, not a quote). Internal time otherwise | Highest. No stake in the product, and product judgment is checked by a second person | Needs onboarding to the rubric, and an NDA if notice text plus Mindy context is considered sensitive (SAM notices themselves are public) |
| **B ($0)** | Primary: internal operations staff (e.g. Shanoor). Second: another internal non-builder | $0 incremental. ≈ 9–15 h of staff time | Moderate. Not the builders, but employees | May lack DLA/NSN fluency; calibration catches this. If calibration agreement is poor, escalate to A |
| Not acceptable as primary | Eric, Agent 3, Agent 4, or any AI | — | Not independent (owner or builder), or not human | The v1 review had exactly this weakness |

Eric may serve as a **tie-breaker** only. Disagreements are reported as ranges by default. Any adjudication Eric makes is reported
separately and never replaces the independent labels in the gate numbers.

AI pre-labelling (two blind Claude reviewers, as in v4) runs inside the existing Claude subscription, with no API spend. Embeddings: only the 14
query vectors need re-embedding (14 calls, within the approved budget). Notice vectors come from production's existing `sow_embedding`.

## 3. Independence safeguards

1. **Blind queue.** One shuffled queue across businesses. The reviewer never sees the variant, the rank, Mindy's DIRECT/related label, the AI
   label, or which outcome helps a release. The gate thresholds are not shown on the labelling page.
2. **Full evidence shown.** Full notice text, SAM.gov link and the sentence that triggered the match. In v1, AI labels undercounted
   subcontract scope when the deciding sentence was out of view.
3. **Frozen rubric.** `INSTRUCTIONS_service.md` / `INSTRUCTIONS_product.md` as of `5109cc9bb`, plus a one-page plain-English guide. No rubric
   edits after the first holdout item is shown.
4. **Calibration first.** 20 pre-freeze items with known human labels. A reviewer who disagrees on relevant-vs-not for more than 4 of 20
   is retrained once, then replaced. Calibration items are never scored.
5. **Agreement measured.** Cohen's κ on the 15% overlap, relevant vs not. **κ < 0.6 means the gate is not certifiable** for that
   snapshot: relabel after retraining, don't average it away.
6. **Sealed labels.** Write-once storage per item, with the edit history kept. Agent 3 gets no access until the scores are published. No
   holdout item is ever used for tuning; one that is becomes part of the training data and leaves the holdout.
7. **Payment independent of outcome.** Paid by the hour, never per pass.

## 4. Sampling sufficiency check (go/no-go on each snapshot date, read-only)

A business enters a snapshot only if both hold. Otherwise it waits for the next weekly snapshot. **The gate requires all 14 businesses, so
a deferred business is "not yet evaluated", never a pass by omission.**

- **≥ 10 relevant code-floor notices expected** in the post-freeze pool. Expected = pool count × the v4 floor relevance rate, confirmed by AI pre-labels.
  On last week's volume (2–3 a week), nursing and guards reach this only around 8 weeks.
- **≥ 8 post-freeze notices shown** in each variant's ranked list (top-20 precision needs a denominator).

## 5. Preconditions before the final holdout runs (all four, per Eric)

| Precondition | Owner | Status |
|---|---|---|
| Frozen release-candidate SHA | Agent 3 | Requested in `HANDOFF-TO-AGENT3-MISSED-NOTICES.md` |
| Reviewer assignments approved (option A or B, named people) | Eric | **Awaiting decision** |
| Labelling protocol and sampling sufficiency verified | Agent 4 | Protocol frozen; sufficiency rule above. Dry run on pre-freeze notices before Dec 12 |
| Mac Studio benchmark environment independently configured | Eric/infra (credentials), Agent 4 (harness) | Harness made portable (`ENVIRONMENT.md`); the Studio still has no `.env.local` of its own |

## 6. Decisions needed from Eric

1. Option A (approve up to about $1,300 for an external primary reviewer) or option B ($0, internal).
2. The names of the primary and second reviewers.
3. Whether an NDA is required for the external reviewer.
