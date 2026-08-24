# Run 3 — role-aware (stage 2). 2/4 pre-committed conditions. Does not pass.

Extraction by a small/cheap model (the production `extraction` tier), prose only, no NAICS
shown. Ranker calls stage 1 unchanged; only the INPUT TEXT differs. Holdout sealed.

## The four conditions, decided in advance

| # | Condition | Result |
|---|---|---|
| 1 | Steward → bridge machinery, NOT machine shop | **FAIL** → `331210` Iron & Steel Pipe |
| 2 | AMTEC → ammunition, NOT explosives | **PASS** `325920` → **`332993`** |
| 3 | Komori → presses, NOT maintenance | **PASS** `811310` → **`333248`** |
| 4 | Loughmiller IS a machine shop (bias guard) | **FAIL** → `332313` Plate Work |

## What role separation demonstrably fixed

Every process/service/input-as-product failure from Run 2 was corrected, on extracted roles:

| Case | Run 2 (flat) | Run 3 (role) | Correct |
|---|---|---|---|
| AMTEC | `325920` Explosives | **`332993`** ✓ | ammunition |
| Komori | `811310` Machinery Repair | **`333248`** ✓ | presses |
| Kinetic Xyber | `561621` alarm install | **`541512`** ✓ | cyber/IT |
| Gator Pump | abstained | **`333914`** ✓ | pumps |

That is the mechanism working exactly as designed. **The hypothesis that role separation
addresses process/service-as-product is supported.**

## Why it still fails — the failure moved upstream

The ranker is no longer the problem. **The extraction is.** For the two failing cases the
model refused to commit to a single core product and returned a compound:

- **w01 Loughmiller:** core = *"Precision machined and fabricated metal parts; CNC milling,
  turning, and waterjet cutting services"* — the parts AND the services, joined.
- **w02 Steward:** core = *"Heavy steel fabricated assemblies and precision machined
  components; specialized machinery such as moveable bridge systems"* — bridge machinery
  demoted to a trailing "such as" clause, behind generic fabrication language.

Fed a compound string, the flat matcher does what it always does: matches the lexically
densest fragment. Steward's "heavy steel ... fabricated" beat "moveable bridge systems";
Loughmiller's "fabricated metal parts" beat "machine shop".

Note the asymmetry — **the extraction placed the correct answer in the string both times.**
It simply did not rank within the role. Condition 4 also proves the design guard did its
job: the failure is *not* a learned bias against process language, because Loughmiller lost
to `332313` Plate Work, another product code, not to a service code.

Also worth recording: **w05 Die-Matic got worse** (`332322` Sheet Metal → `441330`
Automotive Parts *Retailer*) — the served-market phrase "for automotive and aerospace
applications" rode inside the core string and pulled a retail code. Served market is
supposed to be a separate role; the extractor leaked it into core.

And **c15 Blue Halo → `541512`** is still `unacceptable_confident` — an IT hardware reseller
read as a systems-design firm, because the extractor wrote "systems integration services"
into core. Reseller-vs-producer is unfixed.

## Honest reading

- **Stage 2 is directionally right and incompletely implemented.** 4 of Run 2's named
  failure classes are fixed; 2 conditions fail because of extraction quality, not ranking.
- **This is one probe on 9 cases with one cheap model and one prompt.** It is not a
  benchmark run, and the 21-case dev score has NOT been computed for stage 2 — doing so now
  would burn the clean-run discipline on a prototype whose known defect is upstream.
- The obvious next move — constrain extraction to a single primary product, forbid compound
  cores, and separate served-market — **is a prompt change, and prompt-tuning against these
  exact 9 cases is benchmark tuning.** Same rule as before: I will not do it silently.

## What I would do next, for Eric's decision

1. Constrain the extraction contract (single core product; no "; " compounds; served market
   must not appear in core) — a **contract** change, defined from first principles, not from
   which cases failed.
2. Re-extract with that contract and run the full 21-case dev set once, scored under the
   frozen four-bucket rules.
3. If Steward and Loughmiller then both resolve correctly, stage 2 has earned the dev run.

Do NOT proceed to holdout regardless — it stays sealed until a full dev run passes.

Per-case output above; extraction in `fixtures/role-extraction-probe.json`.
