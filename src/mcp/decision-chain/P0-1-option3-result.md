# Option 3 built and measured — the taxonomy path works; my evaluation corpus was wrong.

**Threshold not met on the frozen dev set. Holdout remains sealed.** But the reason is not
that Option 3 fails, and the difference matters more than the score.

## Result on the frozen dev set

| Resolver | Acceptable top | In top-3 | Unacceptable-confident | Abstains |
|---|---|---|---|---|
| Current | 1/8 | 1/8 | several | never |
| Lift | 2/8 | 2/8 | 0 | 3 |
| **Taxonomy (Option 3)** | **1/8** | 3/8 | **0** | 3 |

Below the 6/8 bar. **Zero unacceptable-confident answers** — the safety property holds.

## The finding: input register, not resolver quality

The same resolver, unmodified, on **capability prose** instead of award descriptions:

| Case | Selected | Confidence |
|---|---|---|
| ammunition (**hard negative**) | **332993** ✓ | 14.55 |
| printing machinery (**hard negative**) | **333248** ✓ | 3.66 |
| IT | **541512** ✓ | 96.16 |
| electrical | **238210** ✓ | 25.54 |
| machine shop | 336370 ✗ | 5.37 |

**4/5, and both hard negatives resolve correctly at high confidence.** Genuine ammunition
and printing remain selectable — the constraint that killed lift.

## Why the dev set scores badly

The taxonomy matches incidental nouns in *procurement* text:

| Fixture | Matched | Landed on |
|---|---|---|
| miter gate for **LOCKS** and dam | `locks` | Hardware Manufacturing |
| **CHANGE** IN PSC FROM J054 | `change` | Automotive Oil Change |
| center cell access **PORTS** | `ports` | Deep Sea Freight |
| M430A1-**METAL PALLET** | `metal pallet` | Wood Pallet Manufacturing |

None is a scoring bug. Census index entries describe **what a business does**; award
descriptions state **what was bought on one contract**, in contracting-office voice —
PSC change notices, packaging configurations, place names. The two are different registers,
and the taxonomy is built for the first.

I flagged this risk when building the fixtures ("award descriptions are procurement text,
not capability statements"). The measurement has now confirmed it is decisive, not
cosmetic.

## Honest reading

- The machine-shop capability case genuinely fails: that prose never says "machine shop",
  and `metal parts` → Motor Vehicle Metal Stamping is defensible. Not hidden.
- 5 hand-written capability sentences are **not** a benchmark. They are a directional probe
  and must not be cited as a pass rate.
- **The comparison table above is therefore not apples-to-apples for Option 3.** All three
  resolvers were measured on award prose; only Option 3 was additionally probed on
  capability prose. That probe is evidence about *corpus fit*, not a competing score.

## What this means for P0-1

The production tool receives `description` / `capabilities` / `past_performance` — a
founder's own words. **That is capability register, which is what the taxonomy path is
good at**, and is closer to the probe than to the award-description fixtures.

So the honest next step is not more scoring work. It is fixing the evaluation corpus:

1. Keep the award-description cases as a **robustness** set — real, adversarial, and they
   prove the resolver does not confidently emit nonsense on messy input (0 unacceptable).
2. Add a **capability-register** set sourced from real capability text, labelled the same
   multi-valued way, for the classification threshold.
3. Only then judge against 6/8, and only then open the holdout.

Sourcing note: `lookup_sam_entity` is down (DEFECT-7), and SAM's entity API carries no
capability narrative regardless. Real capability prose would have to come from
`sam_opportunities` vendor text, contractor websites, or Eric's own corpus. **That is a
decision, not something to assume** — hand-writing the set would let me write prose the
classifier happens to win on, which is exactly the failure mode the frozen set exists to
prevent.

## Also fixed here — a vintage defect worth its own attention

**333244 Printing Machinery was RETIRED in the 2022 NAICS revision** (folded into 333248).
USASpending still reports it, because award rows carry the vintage in force at award time.
A 2022-taxonomy resolver *cannot* emit 333244 and would look wrong while being right. The
`dev-printing-banknote` acceptable set now includes both, with the correction documented in
the fixture. Any code comparing taxonomy output to award-derived NAICS needs vintage
mapping.

## Artifacts

- `fixtures/taxonomy/naics-2022.json` — 20,373 index entries + 2,125 titles, Census 2022
- `taxonomy_resolver.py` — candidate selection from taxonomy ONLY; award spend accepted as
  an optional ranking input that cannot alter candidacy; abstention first-class
- `eval_taxonomy.py` — dev/holdout runner

No per-company or per-code special cases exist in the resolver.
