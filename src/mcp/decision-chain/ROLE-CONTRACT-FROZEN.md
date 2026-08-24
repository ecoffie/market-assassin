# Role extraction contract — FROZEN before re-extraction

Committed before any case is re-extracted. Defined from first principles: what a NAICS
classifier structurally needs, not what the 9 probe cases got wrong.

## Definition

> **`core_primary` = the single primary thing the company sells or delivers to a customer.**

The buyer's purchase. One ranked primary offering — **not** "one and only one offering".

## Excluded from `core_primary` (exhaustive)

1. Manufacturing methods and equipment
2. Internal production steps
3. Customer industries / served markets
4. Inputs and materials
5. Examples subordinate to the primary product ("such as X", "including Y")
6. Ancillary maintenance / integration services — **unless those ARE the primary offering**

Exclusion 6 is deliberately conditional. A repair shop's primary offering IS maintenance;
a press manufacturer's is not. The contract must not encode "services are never the product",
which would be the learned bias condition 4 exists to catch.

## Shape

| Field | Type | Ranks? |
|---|---|---|
| `core_primary` | string | **YES — first** |
| `core_secondary` | string[] | Fallback only, when primary is weak/absent |
| `processes` | string[] | Supporting context |
| `services` | string[] | Supporting context |
| `served_markets` | string[] | Supporting context |
| `inputs` | string[] | Supporting context |

`core_secondary` exists because forcing one product on a genuinely multi-line business is a
lossy fiction. A firm that really sells both machinery and services should say so, ranked.

## Extractor-quality audit — scored INDEPENDENTLY of the NAICS outcome

Per case, four boolean defects. This tells us whether a bad classification came from stage 2
extraction or stage 1 matching, **without inferring it from the final code**:

| Flag | Test |
|---|---|
| `served_market_leaked_into_core` | a served-market term appears in `core_primary` |
| `process_leaked_into_core` | a process/method term appears in `core_primary` |
| `ancillary_service_displaced_product` | `core_primary` names a support service while a product appears only in `core_secondary`/`services` |
| `compound_core_unresolved` | `core_primary` contains `;`, " and ", or " / " joining distinct offerings |

Audited by string inspection of the extraction, not by whether the resolver got the code
right.

## Run discipline (unchanged)

- Re-extract **all 21 dev cases once** under this contract. Not just the failing ones —
  scoring a subset would keep the change contaminated by local success criteria.
- Score the **full dev set** under the frozen four buckets. Hard safety condition stands:
  `unacceptable_confident` at 0 or near 0.
- **Holdout stays sealed** regardless of outcome.
