# Human holdout: smaller plan (revision 3, 2026-11-15, for Eric's approval)

**Replaces revision 2's sizing** (`HOLDOUT-PROTOCOL-ADAPTIVE.md` §1, §4). The sealing, leakage controls (§3) and verifier design (§2) of revision 2 are unchanged except where stated.
Nothing starts until Eric approves. No staff member reviews anything. AI labels never count toward a gate.

## Scoring rules (Eric, 2026-11-15, relayed by Agent 5)

| Gate | Counts | Population |
|---|---|---|
| Per-business floor, 40% | **verified Direct matches only**. Related is reported separately | the candidate's top 20, **distinct solicitations** |
| Pooled, 60% | Direct + Related | the same distinct top-20s, all 14 businesses |
| Recall, 50% | Direct + Related | a random sample from the business's own codes |
| Reported, not gated | duplicate-item concentration (e.g. the same kit under several solicitation numbers), Related share, Direct-only pooled rate | — |

The per-business floor is read as ceil(40% × distinct solicitations in the top 20). For RC3, every business's top 20 is already 20 distinct solicitation numbers, so the floor is 8.
Valves' repeated ball-valve kit carries distinct solicitation numbers, so it is not collapsed. It is reported as duplicate-item concentration.

## What makes it smaller

1. **Certify RC3 only** (`search-rc3-2026-11-15` → `5c5098165`, once the tag is confirmed). RC1 and RC2 are scored only where their items overlap RC3's, and are not certified.
2. **Direct floor by exact stopping rule**, AI-ordered. Stop at 8 Direct (pass) or 13 not-Direct (fail).
3. **Pooled leg sequential**: a random draw checked every 20 judgments, from 40 onward. Stop when the one-sided 95% bound (finite-population corrected) clears 60% either way. Leg A judgments count when drawn.
4. **Recall sample 42** (3 per business), not 60. Extend only if the Wilson lower bound sits within 5 points of 50%.
5. **Blind duplicates 8**, not 12. Eric confirms the 8 product calibration answers. Only the verifier does the full 20-item calibration.

## Eric's load (simulated, 300 runs, `v7/scripts/holdout_load_v3.py`)

| Option | Judgments, median (p10–p90) | Eric at 30–45 s each |
|---|---|---|
| **RC3 only, recall 42 (recommended)** | **196 (189–206)** | **≈ 100–150 min**, 4–5 sittings of 30 min |
| RC3 only, recall 60 | 214 (207–224) | ≈ 105–160 min |
| RC2 + RC3, recall 42 | 256 (246–272) | ≈ 130–190 min |
| Revision 2, RC2 only (for comparison) | ≈ 260 | ≈ 130–195 min |

**Plus:** 8 duplicates (≈ 5 min) and confirming 8 calibration answers (≈ 5 min).
**Recommended total:** about 110–160 min in 4–5 sittings, with a not-certified checkpoint after the first ≈ 80 judgments.

## Independent verification

- **Verifier sample:** a blind, stratified random 20% of Eric's items, ≈ 40. Every item in a business that ends within one item of a stopping bar is added.
  On the preview that means paving, steel and guards, ≈ 10–20 more. Total ≈ 50–60 items, about 1.25–1.5 h. The verifier first does the 20-item calibration (≈ 20 min).
- **Agreement:** Cohen's κ on two splits: Direct vs not (the floor) and relevant vs not (pooled and recall). **Both must be ≥ 0.6 to certify.**
  With n ≈ 50 the standard error is about 0.1, so the κ confidence interval is reported alongside.
- **A business is disputed, not certified,** if the verifier's labels would flip its floor outcome. A gate is certified only if it holds under the Rogan–Gladen misclassification adjustment.
- **The cross-check is free:** every item where Eric disagrees with both AI reviewers goes to the verifier as targeted adjudication, outside the κ sample.
- **Pay:** ≈ $75–150 if paid. That needs Eric's approval.

## What the preview predicts under the new rules (AI labels, Nov 14 fixture, short phrasing; diagnostic only)

| Candidate | Pooled relevant, distinct | Below the Direct floor (both AI reviewers agree) |
|---|---|---|
| RC2 | 71–77% of 231 | IT hardware 0–1/13, nursing 5/14, parts 5–6/13, steel 1–2/18 |
| **RC3** | **76–85% of 280** | **guards 6–8/20, steel 5–9/20**. Paving sits exactly at 8/8 |

- **Guards** is a likely floor failure on any Nov–Dec snapshot. The whole Nov 14 pool holds about 6 clear Direct guard solicitations. The guards spot-check (`~/mindy-release-private/guards-related-spotcheck.md`, key sealed) settles how the borderline items fall. Guards and nursing are re-checked on the Jan 9 snapshot either way.
- **Steel** Direct depends on whether pre-engineered metal building notices that do not name steel erection count as Direct. Eric's labels decide.
- **HVAC and medical** have Direct 9–14 and 9–13. They are near enough to the bar that Leg A runs long on them.

## Eric's approvals for this revision

1. Certify RC3 only (recommended), or RC2 + RC3.
2. Recall sample of 42, extended only near the bar.
3. Verifier name and pay, and κ ≥ 0.6 on both splits.
4. Confirm the 8 product calibration answers.
5. The guards spot-check (5 min).

No holdout scoring starts until Eric approves. The Dec 12 snapshot is dumped into `~/mindy-bench-sealed/`, and only its SHA-256 is committed.
