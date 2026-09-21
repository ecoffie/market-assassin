# Blind-label protocol — P0-1 classification benchmark

## The independence limit, stated plainly

Eric's requirement: *"don't let the same person who is developing Option 3 be the sole
judge of the benchmark labels."*

**This is only partially satisfiable here, and pretending otherwise would be the exact
failure this investigation exists to prevent.** What is and is not true:

| Requirement | Status |
|---|---|
| Labels frozen BEFORE any resolver runs on the case | **Enforced.** Temporal, verifiable in git history. |
| Labeller cannot see stored/clicked/spend-derived NAICS | **Enforced.** Prose extracted with codes withheld by construction (`md5(user_email)` only, no code columns in the query). |
| Labeller has no knowledge of Option 3, the taxonomy resolver, or which codes would flatter it | **Enforced.** Fresh agent, no prior context, prompt names no resolver and no expected answer. |
| Labeller is a genuinely independent *party* | **NOT satisfied.** It is another model instance dispatched by me. Correlated priors are likely. |

So this is **blind and pre-committed, not independent in the human sense.** A human
adjudication pass over the frozen labels — especially the `ambiguous` ones and any case
where the resolver later disagrees — remains the real check. Flagged for Eric rather than
papered over.

## Protocol as executed

1. **Blind label.** Labeller reads capability prose only. Emits `acceptable_naics[]`,
   `unacceptable_naics[]` (with the trap named), `confidence`, `reason`, and
   `label: classifiable | ambiguous`. **"Cannot determine" is a valid answer** and is not
   penalised — ambiguous cases become abstention tests, not accuracy cases.
2. **Taxonomy verification is mandatory during labelling**, not after: every emitted code
   must exist in `fixtures/taxonomy/naics-2022.json` `titles`. This catches retired codes
   (333244 → 333248) at label time rather than producing a false failure later.
3. **No resolver output exists yet.** Neither current Mindy nor Option 3 has been run
   against any of these 24 cases. Verifiable: this file and `blind-labels.json` are
   committed before any eval script touches them.
4. **Disagreement → exclusion or `ambiguous`.** Never forced to a code.
5. **Dedup:** one case per company. `user_business_profiles` is one row per user, so this
   holds by construction for the internal set.
6. **30 dev + 15 holdout**, sealed once assigned.
7. **Provenance** on every row: source, retrieval date, taxonomy vintage, label confidence,
   reasoning, and whether verification changed the blind label.

## Scoring — three outcomes, never one accuracy number

| Outcome | Meaning |
|---|---|
| `acceptable_top` | Top choice is in `acceptable_naics` |
| `justified_abstention` | Resolver abstained on a case labelled `ambiguous`, or on low-confidence evidence |
| **`unacceptable_confident`** | **Confidently returned a code in `unacceptable_naics`. THE HARD SAFETY METRIC. Target: zero.** |

An unjustified abstention (abstaining on a clearly classifiable case) is a *quality* miss,
not a safety failure — tracked separately.

## Corpus composition — a known and unfixed gap

The internal corpus (`user_business_profiles`, 163 users) skews heavily to
**IT / cyber / consulting / facility services**. Manufacturing is thin: of 40 rows pulled,
roughly three are manufacturers (precision gears, centrifugal pumps, CNC/additive parts).

**There is no machine shop, no ammunition maker, and no printing-machinery maker in the
internal corpus** — i.e. the exact contamination traps P0-1 is about are absent. Contractor
websites must supply those, labelled under this same protocol, or the benchmark cannot test
the original defect at all.

## Source ledger

| Source | Rows | Role |
|---|---|---|
| `user_business_profiles` | 24 staged | Primary — real pasted capability statements, production register |
| Contractor websites | pending | Fill machining / stamping / ammunition / printing / industrial-equipment gaps |
| `user_capabilities_library` | 44 available | Reserve; 14 users only, heavily concentrated |
| Award descriptions (existing 12) | 12 | **Robustness only** — scored on safety, never accuracy |
