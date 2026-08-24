# P0-3 dry run — measured. No writes performed.

`scripts/measure-sam-extract-dryrun.mjs` — downloads and parses, imports no DB client, so
it cannot write even by accident.

## The four measurements

| # | Measurement | Value |
|---|---|---|
| 1 | **Newest extract** | `SAM_PUBLIC_MONTHLY_V2_20260802.ZIP` (Aug 2 2026) |
| 2 | **File size** | 147,023,194 bytes — **140.2 MB** |
| 3 | **Row count** | **895,429** registrations |
| 4 | **Runtime** | **download 3.5s · parse 2.4s · total ~6s** |

Parse throughput **366,378 rows/s**. The script header's "~700K rows" estimate was low —
it is 895,429.

## Field 34 verified against production data

The claim this whole fix rests on was previously supported only by a layout comment and the
live Entity API. The extract now confirms it directly:

```
C111ATT311C8  332312Y~423310Y~423320Y~423330Y~423390Y~423510Y…
C111BG66D155  624120N
C111JJBMS328  238350N~321918Y~326199Y~337110Y~337127Y~337211Y~337215Y
```

| Signal | Count |
|---|---|
| NAICS entries marked **Y** | 2,228,515 |
| NAICS entries marked **N** | 631,794 |
| Bare codes, **no flag** (→ unknown) | 251,613 |
| Malformed | **0** |

**251,613 bare codes is the case that vindicates the tri-state schema.** Had we stored only
Y codes, those would have been indistinguishable from N. They are genuinely *unknown* and the
normaliser leaves them absent.

## Cross-check: the P0-3 performers

The extract independently reproduces the live-API answers:

| Firm | Lifetime award | 561720 |
|---|---|---|
| OS-DB-JV-2 LLC | $60.4M | **Y** |
| NMI ALASKA, INC. | $79.4M | **Y** |
| FEDCAP REHABILITATION | $109.8M | N |
| J & J MAINTENANCE | $175.9M | N |
| DIDLAKE INC | $74.1M | N |

Two firms flip to **Y**, so the Rule-of-Two for 561720 Small Business would have a real basis
(≥2 capable small businesses) where it currently returns zero. NMI Alaska is a JV, which
plausibly qualifies as small on its own — this is SAM's representation, not our inference.

## Projected write volume

| | |
|---|---|
| Rows in the extract | 895,429 |
| Rows with a NAICS field | 645,808 |
| **Rows gaining size data** | **613,566 (68.5%)** |
| Rows currently in `sam_entities` | 491,323 |
| Max NAICS on one entity | 1,003 |

The extract carries **more** entities than the table holds, so an import both updates existing
rows and inserts new ones. **That is a scope question for Eric, not a given** — the current
importer filters to seed NAICS unless `--all-naics` is passed.

`max NAICS per entity = 1003` is worth noting: a jsonb map that wide is fine, but the derived
`small_business_naics` array on such rows will be large. No row-size risk at these magnitudes,
though it argues for keeping the GIN index on the projection rather than the map for hot
lookups.

## What this changes about the import decision

The earlier concern — "140MB, ~700K rows, unmeasured runtime" — is resolved. **The whole
parse is ~6 seconds.** The cost is entirely in the DB write, not the download or parse.

Remaining decisions, all Eric's:
1. **Scope** — seed NAICS only, or `--all-naics` (895,429 rows)?
2. The migration is **still unapplied**; the columns must exist first.
3. `market-research.ts` still filters on `certifications` — the query-layer fix lands after
   the data.

**No writes were performed. The 9 reserved keys were not used; one request fetched the file.**
