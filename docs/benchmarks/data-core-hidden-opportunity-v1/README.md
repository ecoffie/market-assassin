# Data Core hidden-opportunity benchmark — v1

**Status: research artifact. Relevance labels are AI-generated and UNVERIFIED, except 47 items a human reviewed on 2026-11-14** (`human_label` filled; see `HUMAN-REVIEW-RESULTS.md`).
Unreviewed items: `label_status: "AI_UNVERIFIED"`, `human_label: null`. Agreement between the two AI
reviewers is not human ground truth. Nothing in this folder is wired into the product.

Owner: Agent 4 (Data Core). Audit it supports: "Mindy Data Core — Classification-Resilient Opportunity
Intelligence" (claude.ai artifact Q4L1LUYRvHEqcMuhBKxcAR). Experiment write-up: `EXPERIMENT.md`.
Human review: `review/` and the accept/reject page https://claude.ai/artifact/ALfvurSY5XuhbNCamX1RAi (decisions saved in its `reviews` collection). v2 prototype and results: `v2/EXPERIMENT-V2.md`. Fresh ranking evaluation after #2050: `v3/EXPERIMENT-V3.md`. SAM.gov services + products benchmark and guard-fix evaluation: `v4/EXPERIMENT-V4.md`; release-gate preview, frozen human-holdout protocol and recommendation to Agent 3: `v4/RELEASE-GATE-AND-HOLDOUT.md` (accepted at `5109cc9bb`); full missed-notice handoff: `v4/HANDOFF-TO-AGENT3-MISSED-NOTICES.md`; reviewer plan: `v4/HOLDOUT-REVIEWER-PLAN.md`; portable harness setup: `v4/ENVIRONMENT.md`. Blind scoring of Agent 3 retrieval steps 1+3: `v5/EXPERIMENT-V5.md`; of release-candidate retrieval 1b7f3c129: `v6/EXPERIMENT-V6.md`. Design review request to Agents 1 and 3: `DESIGN-REVIEW-REQUEST.md`.

## Question

When a customer describes their business in plain words, can Mindy's **existing** stored notice vectors
(`sam_opportunities.sow_embedding`, text-embedding-3-small) find open opportunities that title + code
search misses, at a precision a customer would accept? And does requiring a quoted supporting sentence
from the notice body raise precision?

## Contents

| File | What it is |
|---|---|
| `queries.json` | Six synthetic business descriptions (short + profile form). No customer data. |
| `notices.jsonl` | 308 public SAM.gov open notices (snapshot 2026-11-14 ~11:00 ET): ids, title, codes, agency, description + SOW text as cached in Mindy (description ≤4,000 chars, SOW ≤6,000). Emails and phone numbers redacted; `body_sha256_unredacted` lets you prove the text matches the source. |
| `labels.jsonl` | 325 (business, notice) judgments: both reviewers' labels + evidence, adjudication, final label, the exact excerpt the reviewers saw, empty human fields. |
| `retrieval.jsonl` | Per item: in title+code set (A), in body-keyword set, semantic rank/score (profile and short query), umbrella code, in lane, and both evidence-gate outcomes with the quoted sentence. |
| `gate_lexicon.json` | Frozen evidence-gate term lists (sha256 `1d87fc4ead97f200bfa7a85e2966db0a2bc8cea2b17883ebe31205a0733c35b0`). |
| `scripts/gate.py` | The evidence gate (sentence split + term match, returns the sentence). |
| `scripts/score.py` | Recomputes agreement and the gate experiment from these files alone. `--labels human` scores against human labels once filled. |
| `scripts/build_lexicon.py`, `scripts/vocab_raw.json` | How the lexicon was built (`naics_vocabulary` rows read 2026-11-14). |
| `results/*_snapshot.json` | Outputs as computed in-session (audit scores; gate results). |
| `review/REVIEW-PACKAGE.md`, `review/review_sheet.csv` | 11 recovered + 30 random items for accept/reject. |

## How the 325 items were chosen

- **core252** (audit, 2026-11-14): per business, the semantic top-30 for the profile query, plus 12 random
  notices from the title+code ∪ body-keyword set (`random.seed(7)`), deduped and shuffled.
- **ext73** (this validation): every lane candidate in the semantic top-100 not already labeled. The lane =
  semantic top-100 ∩ not in title+code set ∩ NAICS 236*/237*/561210 ("umbrella" codes).

## Labeling protocol

Two independent Claude subagents (Sonnet and Opus) labeled blind to method, scores and codes, from title,
agency and a text excerpt (core252: first 900 chars of SOW-or-description; ext73: first 2,500 chars of
description + SOW). Rubric: FIT / PARTIAL / NO, as written in `review/REVIEW-PACKAGE.md`.

| Set | Items | Exact agreement | Relevant-vs-not agreement | Adjudicated |
|---|---|---|---|---|
| core252 | 252 | 226 | 234 (93%) | 26 (all disagreements; 18 changed relevant-vs-not) |
| ext73 | 73 | 69 | 71 (97%) | 4 |

The adjudicator is also Claude; every adjudicated item is marked. Final label = agreed label, else the
adjudication.

## Known limits (read before quoting any number)

1. **47 human labels, one reviewer.** The 60% production bar requires an independently reviewed benchmark on a holdout. It is not met;
   see `HUMAN-REVIEW-RESULTS.md` for what the 47 labels show.
2. **Small n.** The gated lane shows 20 items (13 relevant). 95% Wilson interval 43–82%.
3. **One snapshot, mostly construction.** Five of six trades contribute nothing hidden; steel and HVAC carry
   the result. Notices close; rerun on a fresh snapshot (time-split holdout) before deciding.
4. **Recall is pooled**: relative to what the methods surfaced and the reviewers judged, not to all open work.
5. **Reviewer view vs gate view.** The gate reads full cached text; reviewers saw an excerpt. Some gate
   sentences lie outside the excerpt (see `EXPERIMENT.md`).
6. **Baselines are approximations** of Mindy's search (codes and title words chosen per trade in the audit).

## Privacy

Public SAM notice text only. No user capability vectors, emails, profiles or credentials. The production
read used the service role with SELECT only.
