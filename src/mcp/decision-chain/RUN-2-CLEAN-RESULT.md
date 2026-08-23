# Run 2 — THE CLEAN ARCHITECTURE RUN. Option 3 does not clear the bar.

Code frozen at `5e844a4b` before the run. Only the two instrument defects were repaired
(stemming, phrase priority). No weight, threshold, confidence rule, generic penalty, or
special case was touched. One run. Holdout sealed.

## Result against the frozen rules

**Classifiable (16)**

| Bucket | n |
|---|---|
| acceptable_top | **2** |
| acceptable_candidate_wrong_order | 3 |
| unjustified_abstention | 5 |
| miss | 3 |
| **unacceptable_confident** | **3** |

**Ambiguous (5)**: justified_abstention 2 · forced_answer_on_ambiguous 3 · unacceptable_confident 0

**HARD SAFETY METRIC — `unacceptable_confident` across dev: 3. Target was 0.**

## Decision: STOP AND REDESIGN

The decision rule required all three: substantial improvement, zero/near-zero
unacceptable-confident, and sensible ambiguous behaviour. **It fails all three.**

- 2/16 acceptable_top vs the current resolver's ~1/8 — not substantial.
- 3 unacceptable-confident, against a target of 0.
- 3 of 5 ambiguous cases got forced answers instead of abstentions.

The stop condition was written in advance as: *"the taxonomy approach systematically
confuses process / product / customer / served-market despite having clean taxonomy data."*
**That is exactly what happened**, and the repairs made it visible rather than causing it.

## The failure is the one predicted, and now it is unambiguous

The instrument now works — Loughmiller resolves to `332710 Machine Shops` at 16.13
confidence, from zero candidates before. So the resolver got a fair look at every case.
With a fair look, it confuses what a company **is** with what it **does**:

| Case | Selected | Correct | Failure class (named in advance) |
|---|---|---|---|
| **w03 AMTEC** | `325920` Explosives Mfg | `332993` Ammunition | **process-as-product** — matched "explosive manufacturing", an input AMTEC makes for its own rounds |
| **w04 Komori** | `811310` Machinery **Repair** | `333248` | **process/service-as-product** — matched "machinery equipment maintenance" |
| **w05 Die-Matic** | `332322` Sheet Metal Work | `332119` | near-neighbour slip on "metal stamping" |
| **w02 Steward** | `332710` Machine Shops | `333998` (332710 acceptable) | **process-as-product** — scored `acceptable_top` only because the blind labeller kept 332710 in the acceptable set |

**Steward is the most important row in this run.** It counts as a pass, and it is really the
predicted failure: the resolver picked "machine shop" — literally true about Steward's
operations — over "moveable bridge machinery", which is what the company *makes*. The
labeller's multi-valued acceptable set is what turned a conceptual failure into a scored
pass. Without that generosity the classifiable score is **1/16**.

This is why the multi-valued labels were right, and why a single headline number would have
hidden it.

## Why more taxonomy work cannot fix it

Every one of these matched a **real Census index entry** with **correct vocabulary**. The
data was clean. The problem is representational: an index entry like "Explosives
manufacturing" or "Machinery maintenance" is lexically indistinguishable, in flat
bag-of-phrases matching, from the same words appearing as a *process*, an *input*, or a
*service line* in a company's prose.

Nothing in the taxonomy encodes "this phrase describes what the firm SELLS" versus "this
phrase describes a step the firm performs". Adding more index entries, better stemming, or
more phrases adds more of the same undifferentiated signal.

**Per the pre-committed rule: stop tuning, redesign the representation. Do not patch
scoring.**

## Also confirmed

- `unacceptable_confident` on **c02 Kinetic Xyber → 561621 Security Systems Services**
  (physical alarm installation) for a cybersecurity firm, and **c15 Blue Halo → 541512**
  for a hardware reseller. Both are the trap the blind labeller named in advance.
- Abstention is too weak: 3 of 5 ambiguous cases got confident answers, including
  **c13 Douglasway → 522210 Credit Card Issuing** — it read "Government Purchase Card"
  and classified the company as a credit-card issuer.

## What survives for the redesign

1. **Taxonomy candidate generation genuinely works** — Loughmiller 332710, and `333248`
   and `332119` both appeared in top-3 for their cases. The *candidate set* is often right
   while the *ordering* is wrong (3 acceptable_candidate_wrong_order).
2. **Contamination is gone.** Zero cases resolved to ammunition-by-dollar-weight. The
   original P0-1 defect class does not appear.
3. The gap is a **product/process/service/market distinction**, which is a representation
   problem, not a vocabulary problem.

That suggests the next architecture keeps taxonomy for *candidate generation* and adds a
representation that can tell a product from a process — not a new scoring function over the
same flat matcher.

Full per-case output: `RUN-2-clean-results.json`.
