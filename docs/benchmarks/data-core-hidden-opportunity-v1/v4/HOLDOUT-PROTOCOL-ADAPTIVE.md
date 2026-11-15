# Human holdout: adaptive protocol (revision 2, 2026-11-15, for Eric's approval)

**What this changes.** It replaces the fixed Tier 1 (≈150) + Tier 2 (≈220–260) sampling in `HOLDOUT-REVIEWER-PLAN.md` §1–2 with one sequential design.
The review sheet (§3), the independent verifier (§4) and the gates are unchanged. If Eric does not approve this revision, the earlier plan stands.

- **Reviewers:** Eric is the only expert reviewer, plus one independent qualified verifier (APEX/SBDC counselor, former CO, GovCon BD consultant).
  **No staff member reviews anything.** The ops administrator was removed from the evaluation on 2026-11-14.
- **AI labels never count toward a gate.** They are used only to decide which item Eric sees next, and as a cross-check on him.
- **Gates (unchanged):**
  - pooled top-20 relevant ≥ 60%
  - no business below 40% (8 of 20)
  - recall within the business's codes ≥ 50%
- **Population:** the Dec 12 snapshot of notices posted after the freeze, using the 14 short phrasings (`q[0]`, the frozen protocol).
  Candidates are RC1 (`search-rc1-2026-11-14`), RC2 (`search-rc2-2026-11-14`, `065451a66`) and, only if Eric approves, RC3 tagged by Dec 5.

## 1. Expert sample: size, how it is drawn, precision, Eric's minutes

Each candidate's top-20 is a finite population: 14 businesses × 20 = 280 items.
On the v7 preview, the union of RC1, RC2 and RC3 top-20s is 492 items (35 per business). An item shared by candidates is judged once and counts for each.

**Step 0, no Eric time.** Two blind AI reviewers label every item in the union and the recall sample. They see the sentence that triggered the match;
the v1 human review showed AI labels miss subcontract scope when that sentence is hidden.
Rule flags are computed from the text: repair/return-to-RFI, FSC 6505/pharmaceutical, sourcing restriction, code-only match.

**Leg A: per-business 40%, exact census with stopping rules, AI-ordered.**
- For each certified candidate × business, Eric judges items until the outcome is certain:
  - **pass** at 8 relevant of 20
  - **fail** at 13 not relevant of 20
- The decision is exact for the snapshot, with no sampling error, because the stopping rules are a census.
- The AI labels only set the order:
  - if the AI predicts a pass, the most-likely-relevant items come first
  - otherwise, the most-likely-not-relevant items come first
- Ordering cannot bias an exact stopping rule. It only shortens the run.
- A business near the bar (AI range 6–10 of 20) is effectively judged in full, because that is where the decision is uncertain. This is the design Agent 5 asked for:
  effort goes where the AI and the rules disagree or where items sit near a gate.

**Leg B: pooled 60%, sequential random sample.**
- Batches of 40 are drawn at random from the certified candidate's 280.
- Stop when the one-sided 95% bound clears the bar either way. The bound uses the finite-population correction.

| Random judgments | True pooled rate | One-sided 95% lower bound | Certifies ≥ 60%? |
|---|---|---|---|
| 80 | 72% | 65.0% | yes |
| 120 | 72% | 66.9% | yes |
| 120 | 66% | 60.6% | just |

- The v7 preview estimate for RC2 short is 67–74%.
- If the true rate is 62–64%, Leg B extends toward the exact census (168 relevant or 113 not relevant of 280).
- Judgments already made in Leg A count wherever the random draw selects them.

**Leg C: recall.**
- ≈ 60 notices are drawn at random from the business's own codes (and the off-code pool O), stratified by business.
- Recall is reported with a Wilson bound. ≥ 50% is certified only if the lower bound clears 50%.

**Expected size (simulated on the v7 preview, 300 runs; `v7/scripts/holdout_load_*.py`).** Eric's time is at 30–45 s per prefilled item.

| Certify | Leg A alone | A + B (120) + C (60) | Eric's time |
|---|---|---|---|
| RC2 only | 142 | **≈ 260** (p10–p90: 255–268) | **≈ 130–195 min**, in 5–6 sittings of 30 min |
| RC2 and RC3 | 195 | **≈ 310** (305–317) | **≈ 155–235 min** |
| RC1 | not certified (preview 38–42%); scored from the items above where shared | + 0 | — |

- **Plus:** 12 blind duplicates (≈ 8 min) and the 20-item calibration (≈ 15 min).
- **Saving:** AI ordering saves ≈ 15 judgments for RC2 alone and ≈ 45 for RC2 and RC3, against random order. The earlier two-tier plan was ≈ 370–410 judgments.
- **Preliminary checkpoint after ≈ 100 judgments (about 1 h):**
  - the first Leg B batch
  - the clearest Leg A decisions

  This produces a preliminary report, clearly marked not certified, with a go/no-go on continuing. It replaces Tier 1.

**What would cut deeper, and why it is not recommended.** Counting AI labels for unanimous items that Eric never sees, corrected by a human audit, would bring the total to
≈ 200, saving ≈ 60 judgments or ≈ 40 min. But then the gate number rests partly on AI labels. Eric's briefs say AI labels are diagnostic and not a
substitute for human judgment. That would need his explicit approval, and Agent 4 recommends it only for the preliminary checkpoint.

## 2. Independent verification that does not depend on Eric for every label

| Check | What | Size | Decides |
|---|---|---|---|
| Independent verifier, blind | A stratified random 20% of Eric's items, without seeing his answers | ≈ 50–60 (≈ 1.5 h) | **κ ≥ 0.6 required to certify.** Below that, results stay preliminary |
| Near-threshold double coding | Every item in a business that ended within 1 item of a stopping bar | ≈ 10–20, folded into the verifier's set | If a verifier disagreement would flip that business, it is reported **disputed, not certified** |
| AI cross-check | Each of Eric's labels compared with the two AI labels, by stratum | all, free | Items where Eric disagrees with both AIs go to the verifier as targeted adjudication (outside the κ sample) |
| Blind duplicates | 5% of items shown to Eric again in a later sitting | 12 | Intra-rater consistency; > 2 of 12 inconsistent means the rubric is clarified before certifying |
| Calibration | 20 pre-freeze items with a sealed answer key; the verifier first, Eric confirms the 8 product references | 20 | Rubric alignment before any holdout item |

**Estimating and correcting label error.**
- From the verifier sample, estimate Eric's two error rates: relevant judged not, and not judged relevant.
- Re-compute each gate with a misclassification-adjusted estimate (Rogan–Gladen), and recompute each near-threshold business under the verifier's labels.
- **A gate is certified only if its outcome is unchanged under the adjustment.**
- On the AI side, the v1 random check matched Eric 30 of 30 (95% CI 89–100%). That supports AI ordering, not AI counting.

## 3. Leakage controls: Agent 3 never sees the holdout

1. **The sample is sealed outside Git.**
   - The item list, sheets, AI labels and Eric's and the verifier's labels live in `~/mindy-bench-sealed/` (mode 700).
   - The research branch is readable by Agent 3, so nothing item-level is committed before publication.
2. **Commit-and-reveal.** At snapshot time, only the SHA-256 of the sealed manifest is committed. This proves the sample was not changed after candidates ran.
3. **Candidates are frozen before the snapshot.** RC tags must exist by Dec 5. Agent 4 runs each tag against the snapshot and checks the commit hashes. Agent 3 does not run candidates on it.
4. **Only aggregates go back.** Agent 3 receives per-business pass/fail and pooled numbers only after certification. No notice ids or missed items go back until every
   candidate on this holdout is scored. A later RC is evaluated on a new snapshot (Jan 9), not this one.
5. **No relays.** Agent 4 runs the AI reviewer subagents with prompts kept in the sealed directory. No session relays item content to Agent 3.

## 4. What Eric must approve

1. This adaptive design in place of Tier 1 + Tier 2, with AI used for ordering only.
2. Which candidates are certified:
   - RC2 alone (≈ 260 judgments, ≈ 2.2–3.3 h), or
   - RC2 and RC3 (≈ 310, ≈ 2.6–3.9 h).
   RC3 counts only if it is frozen by Dec 5.
3. The top-20 definition before Dec 12:
   - (a) raw
   - (b) results shown
   - (c) distinct solicitation families

   It changes the population.
4. The independent verifier's name, and pay if any (≈ $75–150).
5. His 5-minute confirmation of the 8 product calibration answers.
6. Whether counting AI labels at the preliminary checkpoint is acceptable. The default is no.

## 5. Dependencies on Agent 3

- **RC2:** tagged (`065451a66`). No dependency.
- **RC3:** a frozen annotated tag by **Dec 5**, only if Eric makes it a candidate. The branch head `34aad5828` is untagged today.
- **A headless runner at each tag:** a script Agent 4 can execute against the Dec 12 snapshot that emits the matched set and top-20 for the 14 phrasings, so Agent 3
  never handles the snapshot output. The v6/v7 matched sets were produced by Agent 3, so this is new.

**Runner validated by Agent 4 (2026-11-15).** Agent 3's runner `agent3/holdout-runner` @ `c47a0f68d` (`tasks/search-holdout-runner/runner.mts`) was run from Agent 4's own detached
checkouts, on arm64 Node 24, against the fixture snapshot (`2026-11-15T00:52:58.895Z`, 9,701 open; gz sha256 `6cc0bf79…`). It was compared with Agent 4's own script, not the runner's `verify`.

| Check | Result |
|---|---|
| (a) Matched sets | RC1 `8c4ba2ea1` 28/28, RC2 `065451a66` 28/28, RC3 preview `34aad5828` 28/28, all identical to the v7 files |
| (b) Top-20, in order | 28/28 for all three |
| (c) Determinism | RC2 rerun byte-identical (output sha256 `713f7c65…`) |
| (d) Identity | `src.commit` and `src.tags` present. A modified tracked file is refused |
| v7 input files | `a3_matched_sets_rc2_classification.json` and `a3_matched_sets_rc3_preview.json` are byte-identical to the files committed at the tags |
| Cutoff | A later cutoff only removes rows (matched sets are subsets). The open count, 3,887 at Nov 25, matches an independent recount |
| Dump | Read-only; 9,698 rows with `created_at`; the completeness check passed; the result ran offline |

**Route parity, spot-checked by Agent 4 (2026-11-15).** `route-parity.mts` (`agent3/holdout-runner` @ `df02a53d1`) calls the product function
`findOpportunities()` in-process at the tag, against a fake database client that answers from the same snapshot. Results:

| Check | Result |
|---|---|
| RC2 on the fixture | **28/28 identical**: count, 500-row window, top-20 order, classes 28/28, no route errors |
| RC2 on Agent 4's own Nov 15 12:00 dump (with `created_at`) | 28/28 identical |
| Negative control (Agent 4's own tampering) | Two ranks swapped in one phrasing and one matched id dropped in another. Exactly those 2 of 28 were reported as DIFF, so the check is not vacuous |

Limits:
- **Remaining bound:** the in-memory filter evaluation (JS regex for Postgres `~*`) is not Postgres. That rests on the earlier 17/17 live bench. The Map route is not covered.
- This proves the runner reproduces Agent 3's FIND emulation (`eval.mts`), and that the emulation equals `findOpportunities()` over the same rows.
- The runner must live inside a checkout so it can import `@supabase/supabase-js`.
- The Dec 12 snapshot is a `dump` taken on Dec 12 and stored in `~/mindy-bench-sealed/`.

Nothing in this protocol starts until Eric approves it. No production changes, merges, migrations or feature activations.
