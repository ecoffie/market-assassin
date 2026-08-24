# Run 4 — role-aware + frozen contract. Real improvement; still not clearing the bar.

Contract frozen before re-extraction. All 21 dev cases re-extracted once and the full set
scored. Auditor written before the extraction was inspected. Holdout sealed.

## Scored dev result (frozen four buckets)

**Classifiable (16)**

| Bucket | Run 2 (flat) | **Run 4 (role)** |
|---|---|---|
| acceptable_top | 2 | **7** |
| acceptable_candidate_wrong_order | 3 | 1 |
| unjustified_abstention | 5 | 3 |
| miss | 3 | 4 |
| **unacceptable_confident** | **3** | **1** |

**Ambiguous (5):** justified_abstention **0** (Run 2: 2) · forced answers **5**

**Hard safety metric: 1** (Run 2: 3). Not zero.

## What improved, and it is not marginal

**acceptable_top more than tripled, 2 → 7**, and unacceptable-confident fell 3 → 1. The
process/service/input-as-product class is essentially solved:

| Case | Run 2 | Run 4 | |
|---|---|---|---|
| AMTEC | `325920` Explosives | **`332993`** | ✓ ammunition |
| Komori | `811310` Machinery Repair | **`333248`** | ✓ presses |
| Kinetic Xyber | `561621` alarm install | **`541512`** | ✓ cyber |
| Gator Pump | abstained | **`333914`** | ✓ pumps |
| Privacute | abstained | **`541690`** | ✓ |
| ExeQut | `513210` | **`541511`** | ✓ |
| c01 digital services | `924110` (federal govt!) | **`541511`** | ✓ |

## Why it still fails — and the audit isolates it to extraction

**Extraction audit (independent of NAICS outcome): 9/21 clean.**

| Flag | n |
|---|---|
| served_market_leaked_into_core | **0** |
| process_leaked_into_core | 5 |
| ancillary_service_displaced_product | 1 |
| **compound_core_unresolved** | **9** |

The contract fixed served-market leakage completely (Die-Matic no longer resolves to an
automotive retailer). **Compound cores did not get fixed — 9 of 21 still join two offerings
with "and"**, despite the contract forbidding it. The extractor complied with the shape and
ignored the constraint.

**One auditor caveat, stated rather than hidden:** `w01 process_leaked_into_core` is a
**false positive**. Loughmiller genuinely *sells* machining, so "precision machining" in its
core is correct — the contract explicitly allows a process to be the product, but my regex
cannot tell. The audit over-counts that flag; treat 5 as an upper bound.

**w02 Steward is the true remaining failure and it is now clearly an extraction failure.**
Core came back `"Heavy steel fabrication and precision machining"` — moveable bridge
machinery is absent from `core_primary` **and** from `core_secondary`. The correct answer is
no longer in the string at all, so no ranker could recover it. Run 3's extraction at least
mentioned it in a trailing clause; this one dropped it.

**w01 Loughmiller now abstains** (was correct in Run 2 by flat matching). The compound
"machining and fabrication services" splits its own signal.

## Abstention regressed, and that matters

**Justified abstention went 2 → 0. All 5 ambiguous cases got forced answers**, including
`c13 Douglasway → 622110 General Medical Hospitals` and `c24 → 624190`. Cleaner core strings
raise confidence scores, so the unchanged threshold now passes cases it used to refuse. The
confidence rule was deliberately not retuned — doing so after seeing this would be exactly
the benchmark tuning ruled out.

## Reading

The architecture is working: **role separation fixed the failure class it was designed for,
and the improvement is large.** What remains is not a ranking problem and not a taxonomy
problem — it is that the extractor does not honour "one offering", and one case
(Steward) lost its product entirely.

That is a **contract-compliance** problem in a cheap-model extraction step, which is a
different and more tractable class than the representational failure that killed Run 2.

## What I have NOT done

- No threshold/confidence retune, despite abstention regressing.
- No prompt iteration against these cases.
- Holdout sealed — four runs, untouched.

Decision belongs to Eric. The honest options are: (a) enforce the single-offering constraint
structurally rather than by instruction — reject a compound core and re-ask, which is a
validation rule, not prompt tuning; (b) use a stronger model for extraction; (c) stop here
and conclude stage 2 is promising but not yet robust enough for holdout.

Per-case: `RUN-4-results.json`. Audit: `RUN-4-extraction-audit.json`.
