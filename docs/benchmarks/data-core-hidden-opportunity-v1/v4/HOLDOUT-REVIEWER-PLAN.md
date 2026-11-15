# Human holdout: revised review plan (2026-11-14, for Eric's approval)

**Supersedes the earlier option A/B plan.** Option B is cancelled, and the earlier internal reviewer assignment is withdrawn (Eric, 2026-11-14).
**Eric is the subject-matter expert reviewer**, with a workload designed to be small. An independent qualified reviewer verifies a subset of his judgments.
**AI labels are never counted** in any number below. They are not verification and never substitute for a human label.

Release gates (unchanged): pooled top-20 relevant ≥ 60%; **no business below 40%**; recall within the business's codes ≥ 50%. Retrieval,
evidence classification and ranking are reported separately.
- **RC1:** tag `search-rc1-2026-11-14` (`8c4ba2ea1`, frozen).
- **RC2:** Agent 3's separately tagged candidate with classification and ranking work.
- Both are scored on the same fresh holdout, and labels stay sealed from Agent 3.

**Frozen release candidate (verified by Agent 4, 2026-11-14):** `search-rc1-2026-11-14` is an annotated tag at `8c4ba2ea1`, and `src/` is identical to `761b8d73b`.
That is rc2_phrase retrieval with no PSC 6505, and classification and ranking unchanged. On the AI-labelled benchmark it still fails top-20 (≈ 38–42%, v6).

## 1. Two tiers: preliminary first, certification only if it is earned

| | Tier 1: preliminary expert evaluation | Tier 2: formal certification (only if Tier 1 shows RC2 plausibly passes) |
|---|---|---|
| Expert judgments | **≈ 150** | ≈ 220–260 more |
| Eric's time (30–45 s each, prefilled sheet) | **≈ 1.5–2 h**, in 3–4 sittings of 30 min | ≈ 2–3 h |
| Independent verifier | 30 of Eric's items (20%) | 50 more (20%) |
| Can establish | Pooled top-20 for RC2 within about ±11 points (RC1 about ±13); whether RC2 is clearly above or below 60%; which businesses are clearly failing; repair, restriction and code-only behaviour; how well Eric and the verifier agree | **All three gates, exactly, for this snapshot**: the per-business 40% leg by census with stopping rules, pooled 60%, and recall ≥ 50% with a confidence bound |
| Cannot establish | **Any gate certification.** With 5–7 judgments per business, the per-business 40% leg is ±30–39 points, so it is directional only | Behaviour beyond this snapshot and these 14 businesses |

**Why not certify from a small sample?** One business's top-20 on a snapshot is a population of 20. Labelling all 20 gives an exact answer.
A sample of 8 leaves ±28 points; 5 leaves ±39.
For the pooled leg, 100 random judgments give ±9 points and 150 give ±8. The full 280 has no sampling error for the snapshot.

| Judgments (pooled top-20) | 95% half-width at 60% | | Judgments per business (of 20) | Half-width at 50% |
|---|---|---|---|---|
| 50 | ±13 | | 5 | ±39 |
| 100 | ±9 | | 8 | ±28 |
| 150 | ±8 | | 10 | ±22 |
| 280 (census) | exact for the snapshot | | 20 (census) | exact |

**Tier 2 saves time with exact stopping rules, not approximation.** A business **passes** the 40% leg as soon as 8 of its 20 are judged relevant. It **fails**
as soon as 13 are judged not relevant. Expected judgments per business (simulated): ≈ 8–10 when clearly good, ≈ 14–16 when clearly bad, ≈ 18–19 near the bar.
The pooled 60% leg stops at 168 relevant (pass) or 113 not relevant (fail) out of 280. Items RC1 and RC2 share are judged once and count for both.
RC1 is expected to fail (AI-label preview 38–42%), so it gets Tier 1 only unless Eric asks for RC1 certification too.

## 2. Tier 1 sampling (≈ 150 judgments)

Per business (14 × 10 = 140), random within each stratum:

| Stratum | Per business | Purpose |
|---|---|---|
| RC2 top-20: 3 from ranks 1–10, 2 from ranks 11–20 | 5 | ranking and top-20 relevance (counts for RC1 too where shared) |
| RC1 top-20 rows absent from RC2's top-20 | 2 | RC1-specific top-20; what RC2's re-ranking dropped |
| Notices filed under the business's own codes (NAICS/PSC/FSC) | 2 | recall within codes |
| A notice neither candidate retrieved (from the off-code probe or a random open notice) | 1 | missed relevant work, and blinding: the expert cannot assume every item is a "result" |

Plus **10 pooled hard cases**:
- DLA repair or return-to-RFI notices (2)
- approved-source or QPL items (2)
- code-only rows Mindy marks related (2)
- NSN or part-number items (2)
- PSC 6505 and pharmaceutical edge cases (2)

Strata come from the candidates' own outputs, never from AI labels. The 14 businesses cover 5 services, 2 construction trades and 7 product lines.

## 3. The review sheet

One item per screen or row, shuffled so businesses, candidates and strata are mixed. **Hidden from the reviewer:** Mindy's direct/related label, rank,
candidate name (RC1/RC2), stratum, and any expected or AI answer.

| Shown | Source |
|---|---|
| Business description (short and full) | the benchmark phrasing |
| Opportunity title, agency, notice type, response deadline | `sam_opportunities` |
| **The actual requirement**: the notice's own statement of work or item description (first ~1,500 characters, plus the sentence that triggered the match) | description / SOW text |
| NAICS, PSC/FSC, NSN or part numbers found in the text | notice fields plus extracted identifiers |
| Set-aside, and sourcing restrictions stated in the text (approved source, QPL, brand name, OEM, sole source), shown as quotes | extracted from the text |
| Link to the original notice on SAM.gov | `https://sam.gov/opp/<id>/view` |

**Choices (one required):**
1. **Direct match:** the main thing being bought is what this business offers.
2. **Related opportunity:** what this business offers is an explicit, real part of a larger buy (a component or a subcontract scope).
3. **Not relevant.**
4. **Insufficient information:** the notice text does not say enough to judge.

Plus an **optional short explanation** field.

Scoring: relevant = Direct + Related, with Direct-only also reported. "Insufficient" is reported separately and excluded from the denominator. If more than 10%
of a business's items are insufficient, that business is reported as not evaluable.

**Rulings shown on the instructions page (Eric, 2026-11-14):**
- For a parts-only supplier, repair or return-to-RFI notices are not relevant unless the business says it repairs.
- A generic medical-supply business does not sell pharmaceuticals or FSC 6505.
- A restriction never changes relevance; it is recorded.

**Interface:** reuse the private accept/reject review page from the v1 human review, extended to four choices plus explanation. Eric has used it before. It works on
a phone and saves each decision as it is made. Fallback: a CSV with a dropdown column. Either way, the finished labels are **exported to a sealed local directory
outside Git** (`~/mindy-bench-sealed/`, owner-only permissions). They are never committed or shared with Agent 3 until the scores are published, because the
research branch is readable by Agent 3.

## 4. Independent verification of Eric's judgments

Eric directs Mindy's development, so his labels need an independent check.

- **Who:** one qualified person with no role in Mindy's development and no stake in the outcome. Candidates: an APEX Accelerator procurement counselor, an SBDC
  government-contracting advisor, a former contracting officer or contract specialist, or an experienced GovCon proposal/BD consultant. Not staff, not an AI.
- **What:** a stratified random **20%** of Eric's judgments (≈ 30 in Tier 1, ≈ 50 more in Tier 2), on the same sheet, **blind to Eric's answers**.
- **Calibration first:** the verifier completes 20 pre-freeze items (`calibration/CALIBRATION-PACKET.md`). The 12 service references are Eric's v1 human labels.
  The 8 product references are provisional until Eric confirms them, which takes about 5 minutes. The answer key is sealed outside Git.
- **Measure:** agreement on relevant vs not (Cohen's κ, plus raw agreement), and a list of every disagreement. **κ ≥ 0.6 is required for certification.** If κ < 0.6,
  results stay preliminary, the disagreements are reviewed, and the rubric is clarified before any re-run.
- **Cost:** about 1.5 h of the verifier's time. If the verifier is paid (≈ $50–$100/h, so ≈ $75–$150), **that needs Eric's approval**. Nothing is spent until then.

## 5. Revised timeline (December 12 holdout)

| Date | Step | Owner |
|---|---|---|
| By Nov 21 | Approve this plan; name the independent verifier | Eric |
| By Dec 5 | RC2 frozen under its own tag. A tag after Dec 5 is not evaluable on the Dec 12 holdout | Agent 3 |
| Dec 1–10 | Dry run: Eric confirms the 8 product calibration answers (5 min); verifier completes the 20-item calibration (20 min); review page tested on pre-freeze notices | Eric, verifier, Agent 4 |
| Dec 12 | Coverage check; snapshot; blinded Tier 1 sheet built (≈ 150 items) | Agent 4 |
| Dec 13–17 | Tier 1: Eric 3–4 × 30 min; verifier 30 items | Eric, verifier |
| Dec 18 | **Preliminary report** (clearly marked not certified). Go/no-go for Tier 2: RC2 pooled point estimate ≥ 55% and no business clearly failing | Agent 4 → Eric |
| Dec 18–22 | Tier 2, if go: stopping-rule census of RC2's top-20 plus a recall sample of ≈ 60 code-floor notices; verifier 20% | Eric, verifier |
| ≈ Dec 23 | Certification report for the 12 businesses with enough December volume | Agent 4 |
| Jan 9 | Guards and nursing snapshot (≈ 40 judgments, ≈ 30 min); certification complete for all 14 around Jan 12 | Eric, Agent 4 |

## 6. Out of scope until approval

No final human review starts and the frozen release candidate does not change until this plan is approved. No production changes, merges, migrations or feature activations.
