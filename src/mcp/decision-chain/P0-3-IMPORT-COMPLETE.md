# P0-3 full registry import — COMPLETE. Reconciled, zero failures.

`--all-naics`, `SAM_PUBLIC_MONTHLY_V2_20260802.ZIP`. Exit 0. **Both accounting identities
BALANCE.**

## Reconciliation (the importer's own output)

```
lines read              895,431
  parsed                895,429
  unparseable                 0
  structural (BOF/EOF)        2
  accounted             895,431  BALANCES

kept                    895,429
  upserted              887,339
  deduped in batch        8,090   (same UEI twice in one batch)
  failed (dead-letter)        0
  accounted             895,429  BALANCES

REGISTRY CHANGE
  updated existing      470,453
  newly inserted        416,886
  sam_entities total    910,123
```

Runtime ~13 minutes. No dead-letter file was created.

## THE REGISTRY EXPANSION — this is the headline, not the P0-3 fix

| | Before | After | Change |
|---|---|---|---|
| `sam_entities` total | 493,237 | **910,123** | **+416,886 (+85%)** |
| Active, not excluded | ~416,736 | **775,457** | **+358,721** |

**Mindy's contractor universe nearly doubled.** Anything reading `sam_entities` — search
result counts, "N contractors" figures, market-depth counts, matching pools — now sees a
substantially different population.

### Eric's rule, restated because it now matters operationally

> *"Do NOT immediately interpret every increase in contractor counts as 'new market supply.'
> Some of that will be registry completeness rather than newly active competitors."*

The +416,886 are **registered entities that were always there** and that Mindy had never
ingested, because the old importer only pulled 8 seed NAICS via a rate-limited API. They are
not new market entrants. Customer-facing surfaces must distinguish:

| Tier | Meaning | Count |
|---|---|---|
| **Registered** | in SAM | 910,123 |
| **Active** | registered, not excluded | 775,457 |
| **Recent performer** | has award history | *unchanged by this import* |

The Rule-of-Two tiering (`active_performer` / `capable` / `emerging` / `registered_only`)
already encodes this distinction and correctly excludes `registered_only` from depth. That
design now carries far more weight, since registered-only is the tier that just grew most.

## Data landed correctly

| Check | Result |
|---|---|
| Rows with a tri-state map | 887,310 |
| Rows with ≥1 small-business code | 445,079 |
| Rows with extract provenance | 887,310 (100% of mapped) |

Per-NAICS, active/non-excluded:

| NAICS | total | small (Y) | not small (N) | **unknown** |
|---|---|---|---|---|
| 561720 Janitorial | 22,491 | 20,074 | 2,336 | **0** |
| 541512 Computer Systems Design | 45,934 | 39,911 | 5,739 | **0** |
| 541611 Admin Mgmt Consulting | 64,865 | 56,744 | 7,809 | **0** |

Zero unknowns in the evaluated markets. The tri-state schema is doing its job — N is stored
and distinguishable, not collapsed into "not small by absence".

## Baseline caveat, stated plainly

The pre-import snapshot Eric requested arrived **after** the run had started (96K lines in,
~44K rows already inserted), so a true pre-state was no longer capturable. Recovered exactly:
`sam_entities` was 493,237 before, and the importer's `updated`/`inserted` split makes the
delta fully reconstructable. **Not recovered:** per-NAICS pre-counts for the other evaluated
codes, search-result counts, and dashboard figures. See `P0-3-PREIMPORT-BASELINE.md`.

## Next, in Eric's sequence

4. Switch `market-research.ts` so `set_aside: "Small Business"` queries the per-NAICS size
   flag instead of `certifications`.
5. Re-run 561720 and verify the Y performers flow through into `marketDepth`/`capableDepth`.

**Not done yet.** Step 4 is the query-layer change that closes P0-3.
