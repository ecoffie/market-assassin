# Stage 2 — role-aware classification. Design before code.

## What changed and why

Option 3 is **not replaced.** Run 2 proved its candidate generation works (Loughmiller
332710 at 16.13; `333248` and `332119` both surfaced in top-3 for their cases) and that it
eliminated the original dollar-weight contamination entirely. The defect was asking the
candidate generator to also be the judge.

```
BEFORE  prose -> taxonomy match -> flat phrase score -> answer
AFTER   prose -> ROLE EXTRACTION -> taxonomy candidates -> role-aware ranking -> abstention
                 ^^^^^^^^^^^^^^^                          ^^^^^^^^^^^^^^^^^^
                 new stage 2                              ranks on CORE role only
```

## Roles

| Role | Ranks the NAICS? | Example (Steward) |
|---|---|---|
| `core_product_service` | **YES — the only ranking signal** | "moveable bridge machinery" |
| `production_process` | No — supporting context | "machining, welding, gear cutting" |
| `equipment_capability` | No | "500 tons lifting capacity, CNC machinery" |
| `customer_served_market` | No | "defense, aerospace, navy, automotive" |
| `inputs_materials` | No | "heavy steel" |
| `past_performance_context` | No | "115 years, three plants" |

The Steward failure is the design case: "precision machine shop" is a true
`production_process` / `equipment_capability` claim. It stays recognised — it just stops
being allowed to outrank the `core_product_service`.

## The failure classes this must fix (from Run 2, all on dev)

| Case | Run 2 selected | Correct | Class |
|---|---|---|---|
| w02 Steward | 332710 Machine Shops | 333998 | process-as-product |
| w03 AMTEC | 325920 Explosives Mfg | 332993 | input-as-product |
| w04 Komori | 811310 Machinery Repair | 333248 | service-as-product |
| w05 Die-Matic | 332322 Sheet Metal | 332119 | near-neighbour |
| c02 Kinetic Xyber | 561621 alarm install | 541512 | physical-vs-cyber |
| c15 Blue Halo | 541512 | 423430 | reseller-as-producer |
| c13 Douglasway | 522210 Credit Card Issuing | (ambiguous) | procurement-language trap |

## The architecture test — one question, decided in advance

> **Given the same candidate set, can the system distinguish what the firm SELLS from how
> the firm PRODUCES it?**

**If it cannot, do not proceed to more scoring work.**

Concretely, stage 2 passes only if:
1. Steward's `core_product_service` is bridge machinery, NOT "machine shop";
2. AMTEC's is ammunition/grenades, NOT explosives;
3. Komori's is printing presses, NOT maintenance;
4. Loughmiller's IS "machine shop" — the one case where the process genuinely IS the product.

(4) is the guard against a stage 2 that simply learns to distrust process language. A
prototype passing 1–3 while failing 4 has not learned role; it has learned a bias.

## Cost and placement

Role extraction is one LLM call per classification, on `call-llm.ts` job type `extraction`
(already exists, already has provider fallback). `capability_market_match` is a metered
combination tool at 100 credits and already makes several calls, so one extraction call is
proportionate. Stage 1 stays pure code — no LLM in candidate generation, so taxonomy recall
is unaffected if the LLM is unavailable.

**Degradation rule:** if extraction fails, the tool must NOT silently fall back to flat
matching, which is the behaviour Run 2 falsified. It abstains and says why.

## Not doing

- No scoring/threshold tuning against dev cases. The stop-and-redesign rule stands.
- Holdout stays sealed.
