# Run 6 — valid controlled comparison. Does NOT clear the bar. Recommend stopping.

Instrument repaired (validation 20/21 and 19/21 — Run 5 was 2/21 and 6/21), identical
contract, identical prompt, same taxonomy resolver, only the model tier differs. This is the
comparison Eric asked for, and it is scoreable. Holdout sealed.

## Result

**Classifiable (16)**

| Bucket | Run 2 flat | Run 4 role | **R6 cheap** | **R6 strong** |
|---|---|---|---|---|
| acceptable_top | 2 | **7** | 6 | 4 |
| acceptable_candidate_wrong_order | 3 | 1 | 1 | 1 |
| unjustified_abstention | 5 | 3 | 1 | 1 |
| miss | 3 | 4 | 6 | 6 |
| **unacceptable_confident** | 3 | 1 | **2** | **4** |

**Ambiguous (5):** justified abstention — cheap **0/5**, strong **1/5** (Run 5: 5/5 and 4/5)

**Hard safety metric (all dev): cheap 3, strong 4.** Target was 0. **Both worse than Run 4's 1.**

## The decisive finding: neither model ever expressed uncertainty

**`low` confidence used on the primary offering: 0/21 in BOTH arms.**

The contract said explicitly: *"USE THIS WHEN TRUE. Some descriptions genuinely never say
what the company sells, and marking that 'low' is a CORRECT answer, not a failure. Do not
invent a clean-sounding offering to fill the schema."*

Both models ignored it, at both price points. Every extraction claimed medium or high
confidence, including for prose that never states what is delivered.

This kills the two-dimensional confidence design **as implemented via self-report**. Run 5's
5/5 justified abstention was not the gate working — it was the broken validator rejecting
everything. With a working validator, the gate never fires, because the extractor never
admits doubt.

That is a genuine architectural finding, not a tuning problem: **an extractor asked to
self-report confidence in the same call that asks it to produce an answer will produce an
answer.**

## Cheap vs strong — the commercial answer

**The cheap model is not the bottleneck. Neither is the strong one.**

- cheap: validation 20/21, acceptable_top 6, unacceptable_confident 3
- strong: validation 19/21, acceptable_top 4, unacceptable_confident 4

The stronger model was **not better** — slightly worse on both headline metrics. It did win
the single most important case: **Steward → `moveable bridge machinery` → `333998`**, the
architecture's design case, which cheap got "right" only by scoring `332710` from a
process-laden core that the blind labeller happened to allow.

But strong also failed Loughmiller worse (`541512` Computer Systems Design for a machine
shop) and emitted 4 unacceptable-confident answers.

**Conclusion: paying more for extraction does not buy reliability here.** The failure is not
model capability.

## Where the remaining failures actually live

The `miss` count rose to 6 in both arms, and the pattern is consistent — resellers and
service firms landing on adjacent-but-wrong codes:

- `c05` VEXFOLD → `221114` **Solar Electric Power Generation** (both arms). A distributor of
  solar equipment classified as a power *utility*. Product-vs-distribution, unfixed.
- `c09` Ubun2Group → `518210` Data Processing/Hosting (both arms) for a modernization
  services firm.
- `c15` Blue Halo → `334111` Computer Manufacturing (strong) for a hardware *reseller*.

Reseller-vs-producer and service-vs-infrastructure survive every iteration so far.

## Recommendation: stop

Eric's own stopping condition: *"If it doesn't, stop. At that point we'd have enough
evidence that this shouldn't be solved by adding another extraction layer."*

Evidence across six runs:
- Flat taxonomy matching (Run 2): 2/16, safety 3 — falsified.
- Role-aware (Run 4): 7/16, safety 1 — best result achieved.
- Structural schema + confidence gate (Run 6): 6/16 and 4/16, safety 3 and 4 — **worse**.

**Run 4 remains the high-water mark**, and two further layers of engineering did not beat
it. The last two iterations added machinery and lost ground. That is the signature of an
approach at its ceiling, not one that needs another layer.

**The holdout has not been opened and should not be.** Nothing has earned it.

## What was genuinely established (worth keeping regardless)

1. **Dollar-weight contamination is solved.** Zero cases across four runs resolved by
   spend weight. The original P0-1 defect class is gone.
2. **Role separation is real.** Run 4's 2→7 came from separating what a firm sells from how
   it produces — AMTEC, Komori, Kinetic Xyber, Gator Pump all corrected and stayed corrected.
3. **Self-reported extraction confidence does not work.** Measured, both tiers, 0/21.
4. **Model tier is not the lever.** Cheap ≈ strong; strong slightly worse.

Per-arm output: `RUN-6-cheap-results.json`, `RUN-6-strong-results.json`.
