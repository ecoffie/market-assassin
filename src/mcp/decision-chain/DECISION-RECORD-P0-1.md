# Decision record — P0-1 market classification. CLOSED, development stopped.

**Status:** Development stopped after six runs. Holdout never opened. The experimental
resolver is NOT shipping. A conservative safety fix ships instead.

**Read this before restarting any prose-only classification work.** The point of this record
is that a future session should not re-run this experiment because it believes a stronger
model or a better prompt will solve it. Both were tried and measured.

---

## The conclusion

**Mindy was trying to infer something the input often does not contain.**

Founder and company prose describes products, processes, equipment, served markets, resale,
integration and past work simultaneously. Neither taxonomy matching nor an LLM reliably
determines which of those represents the firm's *industry*.

**Manufacturer vs distributor/reseller is not reliably recoverable from vocabulary alone.**
VEXFOLD (a solar equipment *distributor* → `221114` Solar Electric Power *Generation*) and
Blue Halo (an IT hardware *reseller* → `334111` Computer *Manufacturing`) failed this way in
every architecture tried, at both model tiers.

## Product contract change (supersedes Stage 3)

`capability_market_match` must stop promising *"tell me about your company and I'll determine
your market."*

**Don't infer identity when you can ask or verify identity.** Market identity should come
from declared/verified evidence — selected NAICS, SAM registration, actual award history,
products identified at onboarding. Mindy's intelligence then answers the questions it is
genuinely good at: which of those markets matter, adjacent markets, buyers, competition,
recompetes.

The role/taxonomy work is not wasted — it becomes **validation and recommendation**:

> "You selected 332710. Your capability description strongly supports machining, and also
> suggests adjacent 332119. Want to include it?"

That is a defensible job. *"You are 332710"* is not.

**Click behaviour remains interest, not identity** (see DEFECT-8). A company clicking a
hazardous-waste opportunity must never silently become a hazardous-waste contractor.

---

## The six runs

| Run | Architecture | acceptable_top /16 | unacceptable_confident | Verdict |
|---|---|---|---|---|
| 1 | taxonomy, flat | — | — | **VOID** — no stemmer; "machine shop" ≠ "Machine shops", 14/16 empty candidate lists |
| 2 | taxonomy, flat (repaired) | 2 | 3 | Falsified. Confuses process/product/customer/market despite clean taxonomy data |
| 3 | role-aware (probe, 9 cases) | — | — | 2/4 conditions. Fixed AMTEC/Komori; compound cores blocked Steward/Loughmiller |
| **4** | **role-aware + frozen contract** | **7** | **1** | **HIGH-WATER MARK** |
| 5 | + structural validator | — | — | **VOID** — my validator inferred multiplicity from punctuation, the warned-against mistake |
| 6 | + typed offerings[] + confidence gate, cheap vs strong | 6 / 4 | 3 / 4 | **STOPPING EVIDENCE** — two further layers lost ground |

Baseline for comparison: production's single-keyword resolver scored ~1/8 on real prose,
picking leads like `gate`, `price`, `access`, `examining`.

## Four established findings

1. **Dollar-weight contamination is solved.** Zero cases across four runs resolved by spend
   weight. The original defect — a machine shop returning Ammunition Manufacturing because
   `keywordCoverage('small')` found a $16.3B ammo market — does not recur under taxonomy
   candidate generation.
2. **Role separation is real.** Separating what a firm *sells* from how it *produces*
   drove 2 → 7 and held: AMTEC (`325920`→`332993`), Komori (`811310`→`333248`),
   Kinetic Xyber (`561621`→`541512`), Gator Pump (abstain→`333914`).
3. **Self-reported extraction confidence does not work.** `low` used 0/21 in BOTH arms
   despite the contract stating it was a correct answer. An extractor asked to self-report
   confidence in the same call that asks it to produce an answer will produce an answer.
   Run 5's apparent 5/5 abstention was a broken validator, not a working gate.
4. **Model tier is not the lever.** Cheap ≈ strong; strong slightly worse (4 vs 6
   acceptable_top, 4 vs 3 unacceptable). Paying more does not buy reliability here.

## Two defects found along the way, filed separately

- **DEFECT-7** — `lookup_sam_entity` returns `degraded:true` for every query on deployed
  Mindy, including "Lockheed Martin". Credits charged on failure. Root cause not
  investigated.
- **DEFECT-8** — `extracted_naics_codes` is written from opportunities a user *clicked*, not
  from their description. Conflates "can do X" with "looked at X".

## Assets preserved

- `fixtures/classification-benchmark.json` — 21 dev + **8 sealed holdout**, blind-labelled,
  multi-valued, with hard negatives (real ammunition, printing machinery, stamping).
- `fixtures/taxonomy/naics-2022.json` — 20,373 Census index entries + 2,125 titles.
- `taxonomy_resolver.py`, `role_aware_resolver.py`, `validate_extraction.py` — the
  experimental pipeline, kept for the validation/recommendation use case.
- All six runs' per-case outputs.

**The holdout is sealed and is now an asset for the next genuinely different architecture** —
likely verified identity + capability validation, not prose-only classification. Six
development runs did not contaminate it.

## What ships instead

A conservative safety fix to `capability_market_match` (see next commit): when market
identity is not sufficiently grounded, return candidate codes and say so rather than
manufacturing certainty. Ammunition Manufacturing for an obvious machine-shop query cannot
remain production behaviour while the product contract is redesigned.
